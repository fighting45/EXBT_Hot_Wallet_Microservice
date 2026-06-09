import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { SweepTransaction } from '../../entities';
import { WalletService } from '../wallet/wallet.service';
import { EncryptionService, EncryptedData } from '../encryption/encryption.service';

export interface AddressWithBalance {
  address: string;
  index: number;
  balance: string; // in EXBT
}

export interface SweepResult {
  address: string;
  index: number;
  txHash: string;
  fundingTxHash: string;
  status: 'completed' | 'failed';
  error?: string;
}

@Injectable()
export class SweeperService implements OnModuleInit {
  private readonly logger = new Logger(SweeperService.name);
  private provider: ethers.JsonRpcProvider;
  private hotWallet: ethers.Wallet;
  private hotWalletAddress: string;

  constructor(
    @InjectRepository(SweepTransaction)
    private sweepTxRepo: Repository<SweepTransaction>,
    private walletService: WalletService,
    private encryptionService: EncryptionService,
    private configService: ConfigService,
  ) {
    const rpcUrl  = this.configService.get<string>('EXBT_RPC_URL');
    const chainId = parseInt(this.configService.get<string>('EXBT_CHAIN_ID', '11211'));
    this.provider  = new ethers.JsonRpcProvider(rpcUrl, { chainId, name: 'exbt-testnet' });

    const hotWalletKey = this.configService.get<string>('EXBT_HOT_WALLET_KEY');
    this.hotWallet     = new ethers.Wallet(hotWalletKey, this.provider);
    this.hotWalletAddress = this.hotWallet.address;
  }

  async onModuleInit() {
    if (!this.configService.get('EXBT_HOT_WALLET_KEY')) {
      this.logger.warn('EXBT_HOT_WALLET_KEY not set — sweeper will not work');
      return;
    }
    this.logger.log(`Sweeper initialized — hot wallet: ${this.hotWalletAddress}`);
  }

  /**
   * Scan a range of derived addresses and return those with balance above minBalance.
   * Phase 1 of the sweep flow — called before execution so admin can review.
   */
  async estimateSweep(
    encryptedMnemonic: EncryptedData,
    startIndex: number,
    endIndex: number,
    minBalance = '0.001',
  ) {
    const masterPassword = this.configService.get<string>('MASTER_PASSWORD');
    const mnemonic       = this.encryptionService.decrypt(encryptedMnemonic, masterPassword);
    const minWei         = ethers.parseEther(minBalance);

    this.logger.log(`Scanning addresses ${startIndex}–${endIndex} for balance >= ${minBalance} EXBT`);

    const addressesWithBalance: AddressWithBalance[] = [];

    for (let i = startIndex; i < endIndex; i++) {
      try {
        const { address } = this.walletService.deriveWallet(mnemonic, i);
        const balance      = await this.provider.getBalance(address);

        if (balance > minWei) {
          addressesWithBalance.push({ address, index: i, balance: ethers.formatEther(balance) });
        }
      } catch (err) {
        this.logger.error(`Error checking index ${i}: ${err.message}`);
      }
    }

    const hotBalance    = await this.provider.getBalance(this.hotWalletAddress);
    const feeData       = await this.provider.getFeeData();
    const gasPerTx      = 21000n;
    // Each sweep = 2 txs: fund + sweep
    const gasCostEach   = (gasPerTx * 120n / 100n) * feeData.gasPrice * 2n;
    const totalGasNeeded = gasCostEach * BigInt(addressesWithBalance.length);

    this.logger.log(`Found ${addressesWithBalance.length} addresses to sweep`);

    return {
      addresses_to_sweep:    addressesWithBalance,
      total_exbt:            addressesWithBalance.reduce((s, a) => s + parseFloat(a.balance), 0).toFixed(18),
      hot_wallet_balance:    ethers.formatEther(hotBalance),
      estimated_gas_total:   ethers.formatEther(totalGasNeeded),
      sufficient_balance:    hotBalance > totalGasNeeded,
    };
  }

  /**
   * Execute sweeps for a list of addresses.
   * Phase 2 — processes each address sequentially.
   */
  async executeSweep(
    encryptedMnemonic: EncryptedData,
    addresses: AddressWithBalance[],
  ): Promise<SweepResult[]> {
    const masterPassword = this.configService.get<string>('MASTER_PASSWORD');
    const mnemonic       = this.encryptionService.decrypt(encryptedMnemonic, masterPassword);

    const results: SweepResult[] = [];

    for (const { address, index, balance } of addresses) {
      const result = await this.sweepAddress(mnemonic, address, index, balance);
      results.push(result);
      await this.sleep(2000);
    }

    return results;
  }

  private async sweepAddress(
    mnemonic: string,
    address: string,
    index: number,
    balance: string,
  ): Promise<SweepResult> {
    this.logger.log(`Sweeping ${balance} EXBT from ${address} (index ${index})`);

    try {
      const feeData     = await this.provider.getFeeData();
      const gasPrice    = feeData.gasPrice;
      const gasEstimate = await this.provider.estimateGas({ to: this.hotWalletAddress, from: address });
      const gasLimit    = gasEstimate * 120n / 100n;
      const gasCostWei  = gasLimit * gasPrice;

      // Step 1: Fund address from hot wallet so it can pay gas
      this.logger.log(`Funding ${address} with ${ethers.formatEther(gasCostWei)} EXBT for gas`);
      const fundTx = await this.hotWallet.sendTransaction({ to: address, value: gasCostWei });
      await fundTx.wait(1);

      // Step 2: Get fresh balance after funding
      const currentBalance = await this.provider.getBalance(address);
      const sendAmount     = currentBalance - gasCostWei;

      if (sendAmount <= 0n) throw new Error('Balance too low after gas funding');

      // Step 3: Sweep from user address back to hot wallet
      const { privateKey } = this.walletService.deriveWallet(mnemonic, index);
      const userWallet     = new ethers.Wallet(privateKey, this.provider);

      const sweepTx = await userWallet.sendTransaction({
        to:       this.hotWalletAddress,
        value:    sendAmount,
        gasLimit,
        gasPrice,
      });
      await sweepTx.wait(1);

      await this.sweepTxRepo.save(this.sweepTxRepo.create({
        txHash:          sweepTx.hash,
        fundingTxHash:   fundTx.hash,
        fromAddress:     address,
        toAddress:       this.hotWalletAddress,
        amount:          ethers.formatEther(sendAmount),
        gasFee:          ethers.formatEther(gasCostWei),
        derivationIndex: index,
        status:          'completed',
      }));

      this.logger.log(`Sweep complete for ${address}: ${sweepTx.hash}`);
      return { address, index, txHash: sweepTx.hash, fundingTxHash: fundTx.hash, status: 'completed' };
    } catch (err) {
      this.logger.error(`Sweep failed for ${address}: ${err.message}`);

      await this.sweepTxRepo.save(this.sweepTxRepo.create({
        fromAddress:     address,
        toAddress:       this.hotWalletAddress,
        amount:          balance,
        derivationIndex: index,
        status:          'failed',
        errorMessage:    err.message,
      }));

      return { address, index, txHash: '', fundingTxHash: '', status: 'failed', error: err.message };
    }
  }

  async getSweepStatus(txHash: string): Promise<SweepTransaction | null> {
    return this.sweepTxRepo.findOne({ where: { txHash } });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
