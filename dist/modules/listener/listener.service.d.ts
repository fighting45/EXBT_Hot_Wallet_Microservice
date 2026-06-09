import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ProcessedDeposit, NetworkSyncState } from '../../entities';
export declare class ListenerService {
    private processedDepositRepo;
    private networkSyncStateRepo;
    private configService;
    private provider;
    private monitoredAddresses;
    private isRunning;
    private laravelWebhookUrl;
    private laravelApiSecret;
    private pollIntervalMs;
    constructor(processedDepositRepo: Repository<ProcessedDeposit>, networkSyncStateRepo: Repository<NetworkSyncState>, configService: ConfigService);
    startListener(addresses: Array<{
        user_id: number;
        address: string;
    }>): Promise<void>;
    registerAddress(userId: number, address: string): void;
    private scanBlocks;
    private processBlock;
    private processDeposit;
    private notifyLaravel;
    private getCursor;
    private updateCursor;
    private withRetry;
    private sleep;
}
