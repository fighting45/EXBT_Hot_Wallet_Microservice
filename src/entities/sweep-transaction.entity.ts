import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('exbt_sweep_transactions')
export class SweepTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tx_hash', type: 'varchar', length: 66, nullable: true })
  txHash: string;

  @Column({ name: 'funding_tx_hash', type: 'varchar', length: 66, nullable: true })
  fundingTxHash: string;

  @Column({ name: 'from_address', type: 'varchar', length: 42 })
  fromAddress: string;

  @Column({ name: 'to_address', type: 'varchar', length: 42 })
  toAddress: string;

  @Column({ type: 'decimal', precision: 36, scale: 18 })
  amount: string;

  @Column({ name: 'gas_fee', type: 'decimal', precision: 36, scale: 18, nullable: true })
  gasFee: string;

  @Column({ name: 'derivation_index', type: 'integer' })
  derivationIndex: number;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
