import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { TradeOrder } from '../../entities';
import { OrderService } from './order.service';
import { LbankClient } from './lbank/lbank.client';
import { TradingWebhookService } from './trading-webhook.service';

/**
 * Background reconciliation: periodically pulls the state of every live order from the
 * LBank master account, settles new fills into the user ledger (via OrderService), and
 * delivers order events to Laravel. Also retries any webhooks that previously failed.
 *
 * Mirrors the resilient infinite-loop pattern already used by WithdrawalService and
 * ListenerService. Real-time order events from the WS client short-circuit this loop,
 * which remains the safety net / source of truth.
 */
@Injectable()
export class ReconciliationService implements OnModuleInit {
  private intervalMs: number;
  private enabled: boolean;

  constructor(
    @InjectRepository(TradeOrder) private orderRepo: Repository<TradeOrder>,
    private orders: OrderService,
    private lbank: LbankClient,
    private webhooks: TradingWebhookService,
    private config: ConfigService,
  ) {
    this.intervalMs = parseInt(this.config.get<string>('TRADE_RECONCILE_INTERVAL_MS', '15000'));
    this.enabled = this.config.get<string>('TRADING_ENABLED', 'true') === 'true';
  }

  onModuleInit() {
    if (!this.enabled) {
      console.log('[Trading] TRADING_ENABLED=false — reconciliation loop not started');
      return;
    }
    if (!this.lbank.hasCredentials()) {
      console.warn('[Trading] LBank credentials not set — reconciliation loop idle (market data still works)');
      return;
    }
    this.startLoop().catch(err => console.error('[Trading] Reconciliation loop crashed:', err.message));
  }

  private async startLoop() {
    console.log(`[Trading] Reconciliation loop started — every ${this.intervalMs / 1000}s`);
    while (true) {
      try {
        await this.retryPendingWebhooks();
        await this.reconcileActiveOrders();
      } catch (err) {
        console.error('[Trading] Reconciliation error:', err.message);
      }
      await this.sleep(this.intervalMs);
    }
  }

  /** Settle fills for every order still live on LBank. Called by the loop and the WS client. */
  async reconcileActiveOrders(): Promise<void> {
    const active = await this.orders.findActiveOrders();
    if (active.length === 0) return;

    for (const order of active) {
      try {
        const event = await this.orders.reconcileOrder(order);
        if (event) {
          const fresh = await this.orderRepo.findOne({ where: { id: order.id } });
          await this.webhooks.notifyOrder(event, fresh);
        }
      } catch (err) {
        console.error(`[Trading] Reconcile failed for order ${order.id}:`, err.message);
      }
    }
  }

  /** Reconcile a single order immediately (invoked by WS order events). */
  async reconcileOne(lbankOrderId: string): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { lbankOrderId } });
    if (!order) return;
    const event = await this.orders.reconcileOrder(order).catch(err => {
      console.error(`[Trading] WS-triggered reconcile failed for ${lbankOrderId}:`, err.message);
      return null;
    });
    if (event) {
      const fresh = await this.orderRepo.findOne({ where: { id: order.id } });
      await this.webhooks.notifyOrder(event, fresh);
    }
  }

  private async retryPendingWebhooks(): Promise<void> {
    const pending = await this.orderRepo.find({
      where: {
        webhookStatus: 'pending',
        status: In(['filled', 'partially_filled', 'canceled', 'failed']),
      },
      take: 100,
    });
    if (pending.length === 0) return;

    console.log(`[Trading] Retrying ${pending.length} pending order webhook(s)...`);
    for (const order of pending) {
      const event = this.eventForStatus(order.status);
      if (event) await this.webhooks.notifyOrder(event, order);
    }
  }

  private eventForStatus(status: string): string | null {
    switch (status) {
      case 'filled': return 'order.filled';
      case 'partially_filled': return 'order.partially_filled';
      case 'canceled': return 'order.canceled';
      case 'failed': return 'order.failed';
      default: return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
