import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';

@Entity('exbt_wallet_addresses')
@Unique(['userId'])
@Unique(['address'])
export class WalletAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: number;

  @Column({ type: 'varchar', length: 42 })
  address: string;

  @Column({ name: 'derivation_index', type: 'integer' })
  derivationIndex: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
