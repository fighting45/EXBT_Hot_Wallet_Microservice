import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProcessedDeposit, NetworkSyncState, WalletAddress, ScannedBlock } from '../../entities';
import { ListenerService } from './listener.service';
import { BootstrapService } from './bootstrap.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProcessedDeposit, NetworkSyncState, WalletAddress, ScannedBlock])],
  providers: [ListenerService, BootstrapService],
  exports: [ListenerService],
})
export class ListenerModule {}
