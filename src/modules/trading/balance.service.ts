import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TradeBalance } from '../../entities';
import { Dec } from './decimal.util';

const ASSETS = ['EXBT', 'USDT'];

/**
 * Per-user tradable sub-ledger on top of the pooled LBank master account.
 *
 * `available` is spendable; `locked` is reserved by open orders. Every mutation
 * runs inside a transaction holding a pessimistic_write row lock — the
 * "SELECT FOR UPDATE, no double-spend" guarantee. Methods that must be atomic with
 * order/fill writes accept an external EntityManager so they share one transaction.
 */
@Injectable()
export class BalanceService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  /** Lock (or create) a user's balance row for the given asset within a transaction. */
  private async lockRow(manager: EntityManager, userId: number, asset: string): Promise<TradeBalance> {
    // Ensure the row exists first so the locking read always finds it.
    await manager
      .createQueryBuilder()
      .insert()
      .into(TradeBalance)
      .values({ userId, asset, available: '0', locked: '0' })
      .orIgnore()
      .execute();

    return manager.findOneOrFail(TradeBalance, {
      where: { userId, asset },
      lock: { mode: 'pessimistic_write' },
    });
  }

  // ─── Composable ops (share an external transaction) ──────────────────────────

  /** Move `amount` from available → locked. Throws if insufficient available. */
  async lockFunds(manager: EntityManager, userId: number, asset: string, amount: string): Promise<void> {
    const row = await this.lockRow(manager, userId, asset);
    if (!Dec.gte(row.available, amount)) {
      throw new BadRequestException(
        `Insufficient ${asset} balance: need ${amount}, have ${row.available}`,
      );
    }
    row.available = Dec.sub(row.available, amount);
    row.locked = Dec.add(row.locked, amount);
    await manager.save(row);
  }

  /** Move `amount` from locked → available (e.g. on cancel / over-reservation refund). */
  async unlockFunds(manager: EntityManager, userId: number, asset: string, amount: string): Promise<void> {
    if (Dec.isZeroOrLess(amount)) return;
    const row = await this.lockRow(manager, userId, asset);
    const release = Dec.gte(row.locked, amount) ? amount : row.locked; // never go negative
    row.locked = Dec.sub(row.locked, release);
    row.available = Dec.add(row.available, release);
    await manager.save(row);
  }

  /** Consume `amount` out of locked (settled away, e.g. quote spent on a buy fill). */
  async spendLocked(manager: EntityManager, userId: number, asset: string, amount: string): Promise<void> {
    if (Dec.isZeroOrLess(amount)) return;
    const row = await this.lockRow(manager, userId, asset);
    const spend = Dec.gte(row.locked, amount) ? amount : row.locked;
    row.locked = Dec.sub(row.locked, spend);
    await manager.save(row);
  }

  /** Add `amount` to available (e.g. base received from a buy fill). */
  async creditAvailable(manager: EntityManager, userId: number, asset: string, amount: string): Promise<void> {
    if (Dec.isZeroOrLess(amount)) return;
    const row = await this.lockRow(manager, userId, asset);
    row.available = Dec.add(row.available, amount);
    await manager.save(row);
  }

  // ─── Standalone ops (own transaction) ────────────────────────────────────────

  /** Fund a user's tradable balance (called by Laravel when a user moves funds in). */
  async credit(userId: number, asset: string, amount: string): Promise<TradeBalance> {
    this.assertAsset(asset);
    if (!Dec.isPositive(amount)) throw new BadRequestException('amount must be positive');
    return this.dataSource.transaction(async manager => {
      await this.creditAvailable(manager, userId, asset, amount);
      return manager.findOneOrFail(TradeBalance, { where: { userId, asset } });
    });
  }

  /** Defund a user's tradable balance (Laravel moves funds out). Debits available only. */
  async debit(userId: number, asset: string, amount: string): Promise<TradeBalance> {
    this.assertAsset(asset);
    if (!Dec.isPositive(amount)) throw new BadRequestException('amount must be positive');
    return this.dataSource.transaction(async manager => {
      const row = await this.lockRow(manager, userId, asset);
      if (!Dec.gte(row.available, amount)) {
        throw new BadRequestException(
          `Insufficient ${asset} balance: need ${amount}, have ${row.available}`,
        );
      }
      row.available = Dec.sub(row.available, amount);
      await manager.save(row);
      return row;
    });
  }

  /** All balances for a user, KuCoin-style account list keyed by asset. */
  async getBalances(userId: number): Promise<Record<string, { available: string; locked: string }>> {
    const rows = await this.dataSource.getRepository(TradeBalance).find({ where: { userId } });
    const out: Record<string, { available: string; locked: string }> = {};
    for (const asset of ASSETS) out[asset] = { available: '0', locked: '0' };
    for (const r of rows) out[r.asset] = { available: r.available, locked: r.locked };
    return out;
  }

  private assertAsset(asset: string) {
    if (!ASSETS.includes(asset)) {
      throw new BadRequestException(`Unsupported asset ${asset} (expected one of ${ASSETS.join(', ')})`);
    }
  }
}
