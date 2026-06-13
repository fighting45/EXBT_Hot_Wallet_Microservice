import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('exbt_withdrawals')
export class Withdrawal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: number;

  @Column({ name: 'to_address', type: 'varchar', length: 42 })
  toAddress: string;

  @Column({ type: 'decimal', precision: 36, scale: 18 })
  amount: string;

  @Column({ name: 'gas_fee', type: 'decimal', precision: 36, scale: 18, nullable: true })
  gasFee: string;

  @Column({ name: 'tx_hash', type: 'varchar', length: 66, nullable: true })
  txHash: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @Column({ name: 'webhook_status', type: 'varchar', length: 20, default: 'pending' })
  webhookStatus: string;

  @Column({ name: 'webhook_error', type: 'text', nullable: true })
  webhookError: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date;
}
