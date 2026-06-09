import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { WalletAddress } from '../../entities';
import { EncryptionService, EncryptedData } from '../encryption/encryption.service';
export interface EthWallet {
    address: string;
    privateKey: string;
    derivationPath: string;
    index: number;
}
export declare class WalletService {
    private walletAddressRepo;
    private encryptionService;
    private configService;
    private readonly DERIVATION_PATH;
    constructor(walletAddressRepo: Repository<WalletAddress>, encryptionService: EncryptionService, configService: ConfigService);
    generateMnemonic(wordCount?: 12 | 24): string;
    validateMnemonic(mnemonic: string): boolean;
    deriveWallet(mnemonic: string, index: number): EthWallet;
    isValidAddress(address: string): boolean;
    getOrCreateAddress(encryptedMnemonic: EncryptedData, userId: number, index: number): Promise<{
        walletAddress: WalletAddress;
        isNew: boolean;
    }>;
    getAllAddresses(): Promise<WalletAddress[]>;
    getAddressByUserId(userId: number): Promise<WalletAddress | null>;
}
