import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletAddress } from '../../entities';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { EncryptionModule } from '../encryption/encryption.module';
import { ListenerModule } from '../listener/listener.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WalletAddress]),
    EncryptionModule,
    forwardRef(() => ListenerModule),
  ],
  providers: [WalletService],
  controllers: [WalletController],
  exports: [WalletService],
})
export class WalletModule {}
