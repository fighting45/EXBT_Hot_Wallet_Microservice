import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  WalletAddress,
  ProcessedDeposit,
  NetworkSyncState,
  SweepTransaction,
  Withdrawal,
  ScannedBlock,
} from './entities';
import { EncryptionModule } from './modules/encryption/encryption.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { ListenerModule } from './modules/listener/listener.module';
import { SweeperModule } from './modules/sweeper/sweeper.module';
import { WithdrawalModule } from './modules/withdrawal/withdrawal.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject:  [ConfigService],
      useFactory: (config: ConfigService) => ({
        type:       'postgres',
        host:       config.get('DB_HOST', 'localhost'),
        port:       config.get<number>('DB_PORT', 5432),
        username:   config.get('DB_USERNAME', 'exbotix'),
        password:   config.get('DB_PASSWORD'),
        database:   config.get('DB_DATABASE', 'exbotix_wallet'),
        entities:   [WalletAddress, ProcessedDeposit, NetworkSyncState, SweepTransaction, Withdrawal, ScannedBlock],
        synchronize: config.get('DB_SYNCHRONIZE', 'false') === 'true',
        logging:     config.get('DB_LOGGING', 'false') === 'true',
        extra: {
          max: parseInt(config.get('DB_POOL_MAX', '5')),
          min: 1,
          idleTimeoutMillis: 30000,
        },
      }),
    }),

    EncryptionModule,
    WalletModule,
    ListenerModule,
    SweeperModule,
    WithdrawalModule,
  ],
})
export class AppModule {}
