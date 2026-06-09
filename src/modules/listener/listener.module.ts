import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProcessedDeposit, NetworkSyncState, WalletAddress } from '../../entities';
import { ListenerService } from './listener.service';
import { BootstrapService } from './bootstrap.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProcessedDeposit, NetworkSyncState, WalletAddress])],
  providers: [ListenerService, BootstrapService],
  exports: [ListenerService],
})
export class ListenerModule {}
