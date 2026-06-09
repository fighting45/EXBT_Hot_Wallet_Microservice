import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { WalletAddress } from '../../entities';
import { EncryptionService, EncryptedData } from '../encryption/encryption.service';

export interface EthWallet {
  address: string;
  privateKey: string;
  derivationPath: string;
  index: number;
}

@Injectable()
export class WalletService {
  // BIP44 path for EVM chains — coin type 60 is Ethereum/EVM standard
  private readonly DERIVATION_PATH = "m/44'/60'/0'/0";

  constructor(
    @InjectRepository(WalletAddress)
    private walletAddressRepo: Repository<WalletAddress>,
    private encryptionService: EncryptionService,
    private configService: ConfigService,
  ) {}

  generateMnemonic(wordCount: 12 | 24 = 12): string {
    const entropy = wordCount === 12 ? ethers.randomBytes(16) : ethers.randomBytes(32);
    return ethers.Mnemonic.entropyToPhrase(entropy);
  }

  validateMnemonic(mnemonic: string): boolean {
    try {
      ethers.Mnemonic.fromPhrase(mnemonic);
      return true;
    } catch {
      return false;
    }
  }

  deriveWallet(mnemonic: string, index: number): EthWallet {
    const path = `${this.DERIVATION_PATH}/${index}`;
    const hdWallet = ethers.HDNodeWallet.fromMnemonic(
      ethers.Mnemonic.fromPhrase(mnemonic),
      path,
    );
    return {
      address: hdWallet.address,
      privateKey: hdWallet.privateKey,
      derivationPath: path,
      index,
    };
  }

  isValidAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  /**
   * Get or create a unique EVM address for a user.
   * On first call: derives address at `index` and stores it.
   * On subsequent calls: returns the stored address.
   */
  async getOrCreateAddress(
    encryptedMnemonic: EncryptedData,
    userId: number,
    index: number,
  ): Promise<{ walletAddress: WalletAddress; isNew: boolean }> {
    const existing = await this.walletAddressRepo.findOne({ where: { userId } });
    if (existing) return { walletAddress: existing, isNew: false };

    // Check if index is already in use by another user
    const indexInUse = await this.walletAddressRepo.findOne({ where: { derivationIndex: index } });
    if (indexInUse) {
      throw new ConflictException(`Derivation index ${index} is already assigned to another user`);
    }

    const masterPassword = this.configService.get<string>('MASTER_PASSWORD');
    const mnemonic = this.encryptionService.decrypt(encryptedMnemonic, masterPassword);
    const { address } = this.deriveWallet(mnemonic, index);

    const walletAddress = await this.walletAddressRepo.save(
      this.walletAddressRepo.create({ userId, address, derivationIndex: index }),
    );

    return { walletAddress, isNew: true };
  }

  async getAllAddresses(): Promise<WalletAddress[]> {
    return this.walletAddressRepo.find();
  }

  async getAddressByUserId(userId: number): Promise<WalletAddress | null> {
    return this.walletAddressRepo.findOne({ where: { userId } });
  }
}
