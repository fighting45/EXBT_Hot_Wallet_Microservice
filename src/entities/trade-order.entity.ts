import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * A user order for an EXBT pair. Mirrored 1:1 to the Exbotix LBank master account.
 * `lbankOrderId` links this row to the order on LBank for reconciliation.
 */
@Entity('exbt_orders')
@Index('exbt_orders_user_id_idx', ['userId'])
@Index('exbt_orders_status_idx', ['status'])
export class TradeOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: number;

  @Column({ type: 'varchar', length: 20 })
  symbol: string; // EXBT-USDT

  @Column({ type: 'varchar', length: 4 })
  side: string; // buy | sell

  @Column({ type: 'varchar', length: 8 })
  type: string; // limit | market

  @Column({ type: 'decimal', precision: 36, scale: 18, nullable: true })
  price: string; // null for market orders

  @Column({ type: 'decimal', precision: 36, scale: 18 })
  amount: string; // base amount requested

  @Column({ name: 'filled_amount', type: 'decimal', precision: 36, scale: 18, default: 0 })
  filledAmount: string;

  @Column({ name: 'avg_price', type: 'decimal', precision: 36, scale: 18, nullable: true })
  avgPrice: string;

  @Column({ name: 'locked_amount', type: 'decimal', precision: 36, scale: 18, default: 0 })
  lockedAmount: string; // quote (buy) or base (sell) reserved on the user ledger

  @Column({ type: 'decimal', precision: 36, scale: 18, default: 0 })
  fee: string;

  @Column({ name: 'fee_asset', type: 'varchar', length: 12, nullable: true })
  feeAsset: string;

  // pending → open → (partially_filled) → filled | canceled | failed
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @Column({ name: 'lbank_order_id', type: 'varchar', length: 80, nullable: true })
  lbankOrderId: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @Column({ name: 'webhook_status', type: 'varchar', length: 20, default: 'pending' })
  webhookStatus: string;

  @Column({ name: 'webhook_error', type: 'text', nullable: true })
  webhookError: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
