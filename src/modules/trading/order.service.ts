import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { TradeOrder, TradeFill, TradingPair } from '../../entities';
import { BalanceService } from './balance.service';
import { LbankClient } from './lbank/lbank.client';
import { KucoinMapper } from './mappers/kucoin.mapper';
import { TradingWebhookService } from './trading-webhook.service';
import { Dec } from './decimal.util';
import { LbankOrderInfo, LbankSide } from './lbank/lbank.types';

/**
 * Places, cancels, and settles EXBT pair orders, mirroring each one 1:1 to the Exbotix
 * LBank master account and attributing fills back to the user's internal sub-ledger.
 *
 * Funds reserved per order:
 *   buy  → lock USDT = price*size*(1+feeBuffer)  [market buy: size is already USDT]
 *   sell → lock EXBT = size
 */
@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(TradeOrder) private orderRepo: Repository<TradeOrder>,
    @InjectRepository(TradeFill) private fillRepo: Repository<TradeFill>,
    @InjectRepository(TradingPair) private pairRepo: Repository<TradingPair>,
    @InjectDataSource() private dataSource: DataSource,
    private balances: BalanceService,
    private lbank: LbankClient,
    private webhooks: TradingWebhookService,
    private config: ConfigService,
  ) {}

  private get feeBuffer(): string {
    return this.config.get<string>('TRADE_FEE_BUFFER', '0.002');
  }

  private lockAsset(pair: TradingPair, side: string): string {
    return side === 'buy' ? pair.quoteAsset : pair.baseAsset;
  }

  // ─── Place ───────────────────────────────────────────────────────────────────

  async place(input: {
    userId: number;
    symbol: string;
    side: 'buy' | 'sell';
    type: 'limit' | 'market';
    price?: string;
    size: string;
  }): Promise<TradeOrder> {
    const pair = await this.pairRepo.findOne({ where: { symbol: input.symbol.toUpperCase() } });
    if (!pair || !pair.enabled) throw new NotFoundException(`Trading pair ${input.symbol} not available`);

    if (!Dec.isPositive(input.size)) throw new BadRequestException('size must be positive');
    if (input.type === 'limit' && (!input.price || !Dec.isPositive(input.price))) {
      throw new BadRequestException('price is required and must be positive for limit orders');
    }

    const lockAsset = this.lockAsset(pair, input.side);
    const lockAmount = this.computeLockAmount(pair, input);
    this.validateMinimums(pair, input);

    // Reserve funds + create the order atomically.
    const order = await this.dataSource.transaction(async manager => {
      await this.balances.lockFunds(manager, input.userId, lockAsset, lockAmount);
      const entity = manager.create(TradeOrder, {
        userId: input.userId,
        symbol: pair.symbol,
        side: input.side,
        type: input.type,
        price: input.type === 'limit' ? input.price : null,
        amount: input.size,
        lockedAmount: lockAmount,
        status: 'pending',
      });
      return manager.save(entity);
    });

    // Mirror to LBank (network call, outside the DB transaction).
    try {
      const lbankType = this.toLbankSide(input.side, input.type);
      const result = await this.lbank.createOrder({
        symbol: pair.lbankSymbol,
        type: lbankType,
        amount: input.size,
        price: input.type === 'limit' ? input.price : undefined,
      });
      order.lbankOrderId = result.order_id;
      order.status = 'open';
      await this.orderRepo.save(order);
      console.log(`[Trading] Order ${order.id} placed on LBank as ${result.order_id} (${input.side} ${input.size} ${pair.symbol})`);
      return order;
    } catch (err) {
      // Compensate: release the reservation and mark failed.
      await this.dataSource.transaction(async manager => {
        await this.balances.unlockFunds(manager, order.userId, lockAsset, order.lockedAmount);
        await manager.update(TradeOrder, order.id, {
          status: 'failed',
          lockedAmount: '0',
          errorMessage: err.message,
        });
      });
      const failed = await this.orderRepo.findOne({ where: { id: order.id } });
      this.webhooks.notifyOrder('order.failed', failed).catch(() => undefined);
      throw new BadRequestException(`Order rejected by LBank: ${err.message}`);
    }
  }

  private computeLockAmount(pair: TradingPair, input: { side: string; type: string; price?: string; size: string }): string {
    if (input.side === 'sell') return input.size; // lock base
    // buy
    if (input.type === 'market') return input.size; // size is the USDT to spend
    const notional = Dec.mul(input.price, input.size);
    return Dec.mul(notional, Dec.add('1', this.feeBuffer)); // add taker-fee buffer
  }

  private validateMinimums(pair: TradingPair, input: { side: string; type: string; price?: string; size: string }) {
    if (input.type === 'market' && input.side === 'buy') {
      if (Dec.gt(pair.minFunds, input.size)) {
        throw new BadRequestException(`Order below minimum funds ${pair.minFunds} ${pair.quoteAsset}`);
      }
      return;
    }
    if (Dec.gt(pair.minAmount, input.size)) {
      throw new BadRequestException(`Order below minimum size ${pair.minAmount} ${pair.baseAsset}`);
    }
    if (input.type === 'limit') {
      const notional = Dec.mul(input.price, input.size);
      if (Dec.gt(pair.minFunds, notional)) {
        throw new BadRequestException(`Order below minimum funds ${pair.minFunds} ${pair.quoteAsset}`);
      }
    }
  }

  private toLbankSide(side: 'buy' | 'sell', type: 'limit' | 'market'): LbankSide {
    if (type === 'market') return side === 'buy' ? 'buy_market' : 'sell_market';
    return side;
  }

  // ─── Cancel ──────────────────────────────────────────────────────────────────

  async cancel(orderId: string, userId: number): Promise<TradeOrder> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (Number(order.userId) !== Number(userId)) throw new ForbiddenException('Order does not belong to user');
    if (!['open', 'partially_filled', 'pending'].includes(order.status)) {
      throw new BadRequestException(`Order is ${order.status} and cannot be canceled`);
    }

    if (order.lbankOrderId) {
      const pair = await this.pairRepo.findOne({ where: { symbol: order.symbol } });
      await this.lbank.cancelOrder(pair.lbankSymbol, order.lbankOrderId).catch(err => {
        // If LBank says already filled/closed, fall through to reconcile instead of erroring hard.
        console.warn(`[Trading] LBank cancel for ${order.lbankOrderId} returned: ${err.message}`);
      });
    }

    const pair = await this.pairRepo.findOne({ where: { symbol: order.symbol } });
    const lockAsset = this.lockAsset(pair, order.side);
    await this.dataSource.transaction(async manager => {
      await this.balances.unlockFunds(manager, order.userId, lockAsset, order.lockedAmount);
      await manager.update(TradeOrder, order.id, {
        status: 'canceled',
        lockedAmount: '0',
        webhookStatus: 'pending',
      });
    });

    const canceled = await this.orderRepo.findOne({ where: { id: order.id } });
    this.webhooks.notifyOrder('order.canceled', canceled).catch(() => undefined);
    return canceled;
  }

  // ─── Reconcile / settle from LBank ───────────────────────────────────────────

  /**
   * Pull the order's current state from LBank and settle any newly-filled amount into
   * the user ledger. Idempotent: settles only the delta beyond what we've already booked,
   * guarded by a synthetic fill id keyed on the cumulative deal amount.
   * Returns the event name to emit if status changed, else null.
   */
  async reconcileOrder(order: TradeOrder): Promise<string | null> {
    if (!order.lbankOrderId) return null;
    const pair = await this.pairRepo.findOne({ where: { symbol: order.symbol } });

    const info = await this.lbank.ordersInfo(pair.lbankSymbol, order.lbankOrderId);
    const o: LbankOrderInfo = Array.isArray(info) ? info[0] : info;
    if (!o) return null;

    const newStatus = KucoinMapper.lbankStatus(o.status);
    const newFilled = String(o.deal_amount ?? 0);
    const newAvg = String(o.avg_price ?? 0);

    const deltaBase = Dec.sub(newFilled, order.filledAmount);
    const hasNewFill = Dec.isPositive(deltaBase);

    if (!hasNewFill && newStatus === order.status) return null;

    // Quote moved on this delta = (newAvg*newFilled) - (oldAvg*oldFilled).
    const newQuote = Dec.mul(newAvg, newFilled);
    const oldQuote = Dec.mul(order.avgPrice || '0', order.filledAmount);
    const deltaQuote = Dec.sub(newQuote, oldQuote);

    const lockAsset = this.lockAsset(pair, order.side);
    const isFinal = ['filled', 'canceled'].includes(newStatus);

    await this.dataSource.transaction(async manager => {
      if (hasNewFill) {
        // Idempotency guard: one synthetic fill per cumulative deal amount.
        const fillId = `${order.id}:${newFilled}`;
        const exists = await manager.findOne(TradeFill, { where: { lbankTradeId: fillId } });
        if (!exists) {
          await manager.save(manager.create(TradeFill, {
            orderId: order.id,
            userId: order.userId,
            lbankTradeId: fillId,
            price: newAvg,
            amount: deltaBase,
            fee: '0',
            feeAsset: order.side === 'buy' ? pair.baseAsset : pair.quoteAsset,
          }));

          if (order.side === 'buy') {
            // Spend reserved USDT, receive EXBT.
            await this.balances.spendLocked(manager, order.userId, pair.quoteAsset, deltaQuote);
            await this.balances.creditAvailable(manager, order.userId, pair.baseAsset, deltaBase);
            order.lockedAmount = Dec.sub(order.lockedAmount, deltaQuote);
          } else {
            // Spend reserved EXBT, receive USDT.
            await this.balances.spendLocked(manager, order.userId, pair.baseAsset, deltaBase);
            await this.balances.creditAvailable(manager, order.userId, pair.quoteAsset, deltaQuote);
            order.lockedAmount = Dec.sub(order.lockedAmount, deltaBase);
          }
        }
      }

      // On terminal state, release any remaining reservation (unfilled portion + buy buffer).
      if (isFinal && Dec.isPositive(order.lockedAmount)) {
        await this.balances.unlockFunds(manager, order.userId, lockAsset, order.lockedAmount);
        order.lockedAmount = '0';
      }

      order.filledAmount = newFilled;
      order.avgPrice = newAvg;
      order.status = newStatus;
      if (newStatus !== 'canceled' || hasNewFill) order.webhookStatus = 'pending';
      await manager.save(order);
    });

    if (newStatus === 'filled') return 'order.filled';
    if (newStatus === 'partially_filled' && hasNewFill) return 'order.partially_filled';
    if (newStatus === 'canceled') return 'order.canceled';
    return null;
  }

  // ─── Queries ─────────────────────────────────────────────────────────────────

  async getOrder(orderId: string): Promise<TradeOrder> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async listOrders(userId: number, status?: 'open' | 'done'): Promise<TradeOrder[]> {
    const qb = this.orderRepo.createQueryBuilder('o')
      .where('o.user_id = :userId', { userId })
      .orderBy('o.created_at', 'DESC')
      .take(200);
    if (status === 'open') {
      qb.andWhere('o.status IN (:...s)', { s: ['open', 'pending', 'partially_filled'] });
    } else if (status === 'done') {
      qb.andWhere('o.status IN (:...s)', { s: ['filled', 'canceled', 'failed'] });
    }
    return qb.getMany();
  }

  /** Orders still live on LBank — used by the reconciliation loop. */
  async findActiveOrders(): Promise<TradeOrder[]> {
    return this.orderRepo.createQueryBuilder('o')
      .where('o.status IN (:...s)', { s: ['open', 'pending', 'partially_filled'] })
      .andWhere('o.lbank_order_id IS NOT NULL')
      .getMany();
  }
}
