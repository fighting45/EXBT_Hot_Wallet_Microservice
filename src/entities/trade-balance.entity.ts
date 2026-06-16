import { Entity, PrimaryGeneratedColumn, Column, VersionColumn, UpdateDateColumn, Unique } from 'typeorm';

/**
 * Per-user tradable sub-balance for one asset (EXBT or USDT), held on top of the
 * pooled Exbotix LBank master account. `available` is spendable; `locked` is reserved
 * by open orders. Mutated only inside a pessimistic_write transaction (no double-spend).
 */
@Entity('exbt_trade_balances')
@Unique('exbt_trade_balances_user_asset_unique', ['userId', 'asset'])
export class TradeBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: number;

  @Column({ type: 'varchar', length: 12 })
  asset: string; // EXBT | USDT

  @Column({ type: 'decimal', precision: 36, scale: 18, default: 0 })
  available: string;

  @Column({ type: 'decimal', precision: 36, scale: 18, default: 0 })
  locked: string;

  @VersionColumn()
  version: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
