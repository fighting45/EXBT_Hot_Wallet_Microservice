import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('exbt_scanned_blocks')
export class ScannedBlock {
  @PrimaryColumn({ name: 'block_number', type: 'bigint' })
  blockNumber: number;

  @Column({ name: 'tx_count', type: 'integer', default: 0 })
  txCount: number;

  @Column({ name: 'deposit_count', type: 'integer', default: 0 })
  depositCount: number;

  @CreateDateColumn({ name: 'scanned_at' })
  scannedAt: Date;
}
