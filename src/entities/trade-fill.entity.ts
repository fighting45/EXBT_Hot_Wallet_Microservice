import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * An individual fill (trade) against an order on LBank, attributed back to a user.
 * `lbankTradeId` is unique to guard against double-settling on reconciliation.
 */
@Entity('exbt_fills')
@Index('exbt_fills_order_id_idx', ['orderId'])
export class TradeFill {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: number;

  @Column({ name: 'lbank_trade_id', type: 'varchar', length: 80, unique: true })
  lbankTradeId: string;

  @Column({ type: 'decimal', precision: 36, scale: 18 })
  price: string;

  @Column({ type: 'decimal', precision: 36, scale: 18 })
  amount: string;

  @Column({ type: 'decimal', precision: 36, scale: 18, default: 0 })
  fee: string;

  @Column({ name: 'fee_asset', type: 'varchar', length: 12, nullable: true })
  feeAsset: string;

  @Column({ name: 'traded_at', type: 'timestamptz', nullable: true })
  tradedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
