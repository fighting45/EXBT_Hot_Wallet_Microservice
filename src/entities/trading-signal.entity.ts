import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('trading_signals')
export class TradingSignal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Which pair and timeframe fired this signal
  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Column({ type: 'varchar', length: 10 })
  timeframe: string;

  // LONG or SHORT
  @Column({ type: 'varchar', length: 10 })
  signal: string;

  // The bar's open time in ms (what the strategy fired on)
  @Column({ name: 'bar_timestamp', type: 'bigint' })
  barTimestamp: number;

  @Column({ name: 'bar_datetime', type: 'timestamptz' })
  barDatetime: Date;

  // Price levels
  @Column({ type: 'decimal', precision: 30, scale: 8 })
  entry: string;

  @Column({ name: 'stop_loss', type: 'decimal', precision: 30, scale: 8 })
  stopLoss: string;

  @Column({ name: 'take_profit_1', type: 'decimal', precision: 30, scale: 8 })
  takeProfit1: string;

  @Column({ name: 'take_profit_2', type: 'decimal', precision: 30, scale: 8 })
  takeProfit2: string;

  @Column({ name: 'take_profit_3', type: 'decimal', precision: 30, scale: 8 })
  takeProfit3: string;

  @Column({ name: 'take_profit_4', type: 'decimal', precision: 30, scale: 8 })
  takeProfit4: string;

  @Column({ name: 'take_profit_5', type: 'decimal', precision: 30, scale: 8 })
  takeProfit5: string;

  // Confluence
  @Column({ name: 'confluence_score', type: 'smallint' })
  confluenceScore: number;

  @Column({ name: 'confluence_pct', type: 'decimal', precision: 5, scale: 2 })
  confluencePct: string;

  // Market bias
  @Column({ name: 'bias_label', type: 'varchar', length: 20 })
  biasLabel: string;

  @Column({ name: 'bias_bull', type: 'decimal', precision: 5, scale: 2 })
  biasBull: string;

  @Column({ name: 'bias_bear', type: 'decimal', precision: 5, scale: 2 })
  biasBear: string;

  // Webhook delivery tracking
  @Column({ name: 'webhook_status', type: 'varchar', length: 20, default: 'pending' })
  webhookStatus: string;

  @Column({ name: 'webhook_error', type: 'text', nullable: true })
  webhookError: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
