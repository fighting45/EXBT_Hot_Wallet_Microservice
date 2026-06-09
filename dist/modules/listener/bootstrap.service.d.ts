import { OnModuleInit } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { WalletAddress } from '../../entities';
import { ListenerService } from './listener.service';
export declare class BootstrapService implements OnModuleInit {
    private walletAddressRepo;
    private listenerService;
    private configService;
    constructor(walletAddressRepo: Repository<WalletAddress>, listenerService: ListenerService, configService: ConfigService);
    onModuleInit(): Promise<void>;
}
