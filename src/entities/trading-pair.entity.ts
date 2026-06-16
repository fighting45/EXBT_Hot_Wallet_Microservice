import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Config for a tradable pair. Currently only EXBT-USDT (sourced from LBank).
 * `symbol` is the external KuCoin-style symbol; `lbankSymbol` is what LBank expects.
 */
@Entity('exbt_trading_pairs')
export class TradingPair {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  symbol: string; // e.g. EXBT-USDT

  @Column({ name: 'lbank_symbol', type: 'varchar', length: 20 })
  lbankSymbol: string; // e.g. exbt_usdt

  @Column({ name: 'base_asset', type: 'varchar', length: 12 })
  baseAsset: string; // EXBT

  @Column({ name: 'quote_asset', type: 'varchar', length: 12 })
  quoteAsset: string; // USDT

  @Column({ name: 'price_precision', type: 'int', default: 8 })
  pricePrecision: number;

  @Column({ name: 'amount_precision', type: 'int', default: 8 })
  amountPrecision: number;

  @Column({ name: 'min_amount', type: 'decimal', precision: 36, scale: 18, default: 0 })
  minAmount: string; // min base size

  @Column({ name: 'min_funds', type: 'decimal', precision: 36, scale: 18, default: 0 })
  minFunds: string; // min quote (price*size) value

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
