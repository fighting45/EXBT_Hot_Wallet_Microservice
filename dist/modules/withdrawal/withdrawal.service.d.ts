import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Withdrawal } from '../../entities';
export declare class WithdrawalService {
    private withdrawalRepo;
    private configService;
    private provider;
    private hotWallet;
    private laravelWebhookUrl;
    private laravelApiSecret;
    constructor(withdrawalRepo: Repository<Withdrawal>, configService: ConfigService);
    request(userId: number, toAddress: string, amount: string): Promise<Withdrawal>;
    getStatus(withdrawalId: string): Promise<Withdrawal | null>;
    private broadcast;
    private notifyLaravel;
}
