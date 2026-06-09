import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SweepTransaction } from '../../entities';
import { SweeperService } from './sweeper.service';
import { SweeperController } from './sweeper.controller';
import { WalletModule } from '../wallet/wallet.module';
import { EncryptionModule } from '../encryption/encryption.module';

@Module({
  imports: [TypeOrmModule.forFeature([SweepTransaction]), WalletModule, EncryptionModule],
  providers: [SweeperService],
  controllers: [SweeperController],
})
export class SweeperModule {}
