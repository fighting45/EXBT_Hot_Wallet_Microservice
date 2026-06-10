import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';

@Entity('exbt_processed_deposits')
@Unique(['txHash'])
export class ProcessedDeposit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tx_hash', type: 'varchar', length: 66 })
  txHash: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: number;

  @Column({ type: 'varchar', length: 42 })
  address: string;

  @Column({ type: 'decimal', precision: 36, scale: 18 })
  amount: string;

  @Column({ name: 'block_number', type: 'bigint' })
  blockNumber: number;

  @Column({ type: 'varchar', length: 20, default: 'processed' })
  status: string; // 'pending' | 'processed'

  @Column({ name: 'raw_payload', type: 'text', nullable: true })
  rawPayload: string;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt: Date;
}
