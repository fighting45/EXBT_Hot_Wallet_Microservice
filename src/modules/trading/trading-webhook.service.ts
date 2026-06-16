import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';
import { TradeOrder } from '../../entities';

/**
 * Delivers trading events to the Exbotix Laravel backend, HMAC-signed exactly like the
 * existing deposit/withdrawal webhooks (X-Signature over the JSON body). Order rows carry
 * a webhook_status so failed deliveries are retried by ReconciliationService.
 */
@Injectable()
export class TradingWebhookService {
  private readonly webhookUrl: string;
  private readonly apiSecret: string;

  constructor(
    @InjectRepository(TradeOrder)
    private orderRepo: Repository<TradeOrder>,
    private config: ConfigService,
  ) {
    this.webhookUrl = `${this.config.get('LARAVEL_URL')}/api/v1/trading/webhook`;
    this.apiSecret = this.config.get<string>('LARAVEL_API_SECRET');
  }

  buildOrderPayload(event: string, o: TradeOrder): object {
    return {
      event, // order.filled | order.partially_filled | order.canceled | order.failed
      user_id: Number(o.userId),
      order_id: o.id,
      lbank_order_id: o.lbankOrderId,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      price: o.price,
      amount: o.amount,
      filled_amount: o.filledAmount,
      avg_price: o.avgPrice,
      fee: o.fee,
      fee_asset: o.feeAsset,
      status: o.status,
      error: o.errorMessage,
    };
  }

  /** Send an order event and persist delivery status on the order row. */
  async notifyOrder(event: string, order: TradeOrder): Promise<void> {
    await this.send(this.buildOrderPayload(event, order), order.id);
  }

  /** Fire-and-forget balance update event (not tied to an order row). */
  async notifyBalance(userId: number, asset: string, available: string, locked: string): Promise<void> {
    await this.send(
      { event: 'balance.updated', user_id: Number(userId), asset, available, locked },
      null,
    ).catch(() => undefined);
  }

  private async send(payload: object, orderId: string | null): Promise<void> {
    const json = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', this.apiSecret).update(json).digest('hex');

    try {
      const res = await axios.post(this.webhookUrl, json, {
        headers: { 'X-Signature': signature, 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      if (orderId) {
        await this.orderRepo.update(orderId, { webhookStatus: 'delivered', webhookError: null });
      }
      console.log(`[Trading][WEBHOOK] delivered ${(payload as any).event} → ${res.status}`);
    } catch (err) {
      const status = err.response?.status;
      console.error(
        `[Trading][WEBHOOK] FAILED ${(payload as any).event}\n` +
        `  URL:    ${this.webhookUrl}\n` +
        `  Status: ${status ?? 'no response'}\n` +
        `  Error:  ${err.message}\n` +
        `  Body:   ${err.response?.data ? JSON.stringify(err.response.data) : 'none'}`,
      );
      if (orderId) {
        await this.orderRepo.update(orderId, { webhookStatus: 'pending', webhookError: err.message });
      }
    }
  }
}
