import { OnModuleInit } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SweepTransaction } from '../../entities';
import { WalletService } from '../wallet/wallet.service';
import { EncryptionService, EncryptedData } from '../encryption/encryption.service';
export interface AddressWithBalance {
    address: string;
    index: number;
    balance: string;
}
export interface SweepResult {
    address: string;
    index: number;
    txHash: string;
    fundingTxHash: string;
    status: 'completed' | 'failed';
    error?: string;
}
export declare class SweeperService implements OnModuleInit {
    private sweepTxRepo;
    private walletService;
    private encryptionService;
    private configService;
    private readonly logger;
    private provider;
    private hotWallet;
    private hotWalletAddress;
    constructor(sweepTxRepo: Repository<SweepTransaction>, walletService: WalletService, encryptionService: EncryptionService, configService: ConfigService);
    onModuleInit(): Promise<void>;
    estimateSweep(encryptedMnemonic: EncryptedData, startIndex: number, endIndex: number, minBalance?: string): Promise<{
        addresses_to_sweep: AddressWithBalance[];
        total_exbt: string;
        hot_wallet_balance: string;
        estimated_gas_total: string;
        sufficient_balance: boolean;
    }>;
    executeSweep(encryptedMnemonic: EncryptedData, addresses: AddressWithBalance[]): Promise<SweepResult[]>;
    private sweepAddress;
    getSweepStatus(txHash: string): Promise<SweepTransaction | null>;
    private sleep;
}
