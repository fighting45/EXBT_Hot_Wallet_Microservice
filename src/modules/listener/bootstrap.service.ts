import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { WalletAddress } from '../../entities';
import { ListenerService } from './listener.service';

@Injectable()
export class BootstrapService implements OnModuleInit {
  constructor(
    @InjectRepository(WalletAddress)
    private walletAddressRepo: Repository<WalletAddress>,
    private listenerService: ListenerService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    const autoStart = this.configService.get<string>('AUTO_START_LISTENERS', 'true') === 'true';
    if (!autoStart) {
      console.log('[Bootstrap] AUTO_START_LISTENERS=false — listener not started');
      return;
    }

    try {
      const addresses = await this.walletAddressRepo.find();

      const list = addresses.map(a => ({ user_id: Number(a.userId), address: a.address }));
      console.log(`[Bootstrap] Loaded ${list.length} addresses from DB`);

      // Run in background — don't await, it loops forever
      this.listenerService.startListener(list).catch(err => {
        console.error('[Bootstrap] Listener crashed:', err.message);
      });
    } catch (err) {
      console.error('[Bootstrap] Failed to load addresses:', err.message);
    }
  }
}
