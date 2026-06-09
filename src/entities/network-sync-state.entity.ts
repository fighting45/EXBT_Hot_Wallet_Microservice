import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('exbt_network_sync_state')
export class NetworkSyncState {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  network: string;

  @Column({ name: 'last_processed_block', type: 'bigint', default: 0 })
  lastProcessedBlock: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
