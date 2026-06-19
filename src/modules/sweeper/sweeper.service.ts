import { Injectable, OnModuleInit, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import axios from 'axios';
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
  txHash: string;
  status: 'completed' | 'failed';
  error?: string;
}

@Injectable()
export class SweeperService implements OnModuleInit {
  private readonly logger = new Logger(SweeperService.name);
  private _provider: ethers.JsonRpcProvider;
  private _hotWallet: ethers.Wallet;

  constructor(
    @InjectRepository(SweepTransaction)
    private sweepTxRepo: Repository<SweepTransaction>,
    private walletService: WalletService,
    private encryptionService: EncryptionService,
    private configService: ConfigService,
  ) {}

  private get provider(): ethers.JsonRpcProvider {
    if (!this._provider) {
      const rpcUrl  = this.configService.get<string>('EXBT_RPC_URL');
      const chainId = parseInt(this.configService.get<string>('EXBT_CHAIN_ID', '11211'));
      this._provider = new ethers.JsonRpcProvider(rpcUrl, { chainId, name: 'exbt-testnet' });
    }
    return this._provider;
  }

  private get hotWallet(): ethers.Wallet {
    if (!this._hotWallet) {
      const key = this.configService.get<string>('EXBT_HOT_WALLET_KEY');
      if (!key || key.startsWith('0x_YOUR')) throw new Error('EXBT_HOT_WALLET_KEY is not configured');
      this._hotWallet = new ethers.Wallet(key, this.provider);
    }
    return this._hotWallet;
  }

  private get hotWalletAddress(): string {
    return this.hotWallet.address;
  }

  async onModuleInit() {
    const key = this.configService.get<string>('EXBT_HOT_WALLET_KEY');
    if (!key || key.startsWith('0x_YOUR')) {
      this.logger.warn('EXBT_HOT_WALLET_KEY not configured — sweeper and withdrawals will not work');
      return;
    }
    this.logger.log(`Sweeper initialized — hot wallet: ${this.hotWallet.address}`);
  }

  private readonly BATCH_SIZE  = 200;
  private readonly CONCURRENCY = 5;

  /**
   * Fire a JSON-RPC batch of eth_getBalance calls in one HTTP request.
   * Returns a map of address (lowercase) → balance in wei.
   */
  private async batchGetBalances(addresses: string[]): Promise<Map<string, bigint>> {
    const rpcUrl = this.configService.get<string>('EXBT_RPC_URL');

    const payload = addresses.map((addr, i) => ({
      jsonrpc: '2.0',
      id:      i,
      method:  'eth_getBalance',
      params:  [addr, 'latest'],
    }));

    const { data } = await axios.post<Array<{ id: number; result: string }>>(rpcUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000,
    });

    const map = new Map<string, bigint>();
    for (const item of data) {
      map.set(addresses[item.id].toLowerCase(), BigInt(item.result ?? '0x0'));
    }
    return map;
  }

  /**
   * Derive addresses startIndex–endIndex, batch-fetch their balances, return
   * only those with balance > minWei. Much faster than one getBalance per address.
   */
  private async scanAddresses(
    mnemonic: string,
    startIndex: number,
    endIndex: number,
    minWei: bigint,
  ): Promise<AddressWithBalance[]> {
    // 1. Derive all addresses up-front (CPU-only, no I/O)
    const derived: { address: string; index: number }[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      const { address } = this.walletService.deriveWallet(mnemonic, i);
      derived.push({ address, index: i });
    }

    // 2. Split into chunks and batch-fetch with limited concurrency
    const chunks: typeof derived[] = [];
    for (let i = 0; i < derived.length; i += this.BATCH_SIZE) {
      chunks.push(derived.slice(i, i + this.BATCH_SIZE));
    }

    const found: AddressWithBalance[] = [];

    for (let i = 0; i < chunks.length; i += this.CONCURRENCY) {
      const window  = chunks.slice(i, i + this.CONCURRENCY);
      const results = await Promise.all(
        window.map(chunk => this.batchGetBalances(chunk.map(d => d.address))),
      );

      for (let w = 0; w < window.length; w++) {
        const balanceMap = results[w];
        for (const { address, index } of window[w]) {
          const bal = balanceMap.get(address.toLowerCase()) ?? 0n;
          if (bal > minWei) {
            found.push({ address, index, balance: ethers.formatEther(bal) });
          }
        }
      }
    }

    return found;
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

    this.logger.log(`Scanning addresses ${startIndex}–${endIndex} for balance >= ${minBalance} EXBT (batched)`);

    const addressesWithBalance = await this.scanAddresses(mnemonic, startIndex, endIndex, minWei);

    const [hotBalance, feeData] = await Promise.all([
      this.provider.getBalance(this.hotWalletAddress),
      this.provider.getFeeData(),
    ]);

    const gasPerTx       = 21000n;
    // Each sweep = 2 txs: fund + sweep
    const gasCostEach    = (gasPerTx * 120n / 100n) * feeData.gasPrice * 2n;
    const totalGasNeeded = gasCostEach * BigInt(addressesWithBalance.length);

    this.logger.log(`Found ${addressesWithBalance.length} addresses to sweep`);

    return {
      addresses_to_sweep:  addressesWithBalance.map(({ address, balance }) => ({ address, balance })),
      total_exbt:          addressesWithBalance.reduce((s, a) => s + parseFloat(a.balance), 0).toFixed(18),
      hot_wallet_balance:  ethers.formatEther(hotBalance),
      estimated_gas_total: ethers.formatEther(totalGasNeeded),
      sufficient_balance:  hotBalance > totalGasNeeded,
    };
  }

  /**
   * Scan addresses for balance then sweep all to hot wallet automatically.
   * Single call — no need to pass addresses manually.
   */
  async executeSweep(
    encryptedMnemonic: EncryptedData,
    startIndex: number,
    endIndex: number,
    minBalance = '0.001',
  ): Promise<{ scanned: number; swept: number; results: SweepResult[] }> {
    const masterPassword = this.configService.get<string>('MASTER_PASSWORD');
    const mnemonic       = this.encryptionService.decrypt(encryptedMnemonic, masterPassword);
    const minWei         = ethers.parseEther(minBalance);
    const scanned        = endIndex - startIndex;

    this.logger.log(`Scanning addresses ${startIndex}–${endIndex} (batched) then sweeping to hot wallet...`);

    const addressesWithBalance = await this.scanAddresses(mnemonic, startIndex, endIndex, minWei);

    this.logger.log(`Scan complete — ${addressesWithBalance.length} address(es) to sweep out of ${scanned}`);

    const results: SweepResult[] = [];

    for (const { address, index, balance } of addressesWithBalance) {
      try {
        this.logger.log(`Sweeping ${balance} EXBT at index ${index}...`);
        const result = await this.sweepAddress(mnemonic, address, index, balance);
        results.push(result);
        await this.sleep(2000);
      } catch (err) {
        this.logger.error(`Error sweeping index ${index}: ${err.message}`);
      }
    }

    this.logger.log(`Sweep complete — scanned ${scanned} addresses, swept ${results.length}`);
    return { scanned, swept: results.length, results };
  }

  private async sweepAddress(
    mnemonic: string,
    address: string,
    index: number,
    balance: string,
  ): Promise<SweepResult> {
    this.logger.log(`Sweeping ${balance} EXBT from ${address} (index ${index})`);

    try {
      const feeData    = await this.provider.getFeeData();
      const gasPrice   = feeData.gasPrice;
      const gasLimit   = 21000n; // exact gas for a native transfer — no buffer so nothing is refunded
      const gasCostWei = gasLimit * gasPrice;

      const currentBalance = await this.provider.getBalance(address);
      const sendAmount     = currentBalance - gasCostWei;

      if (sendAmount <= 0n) throw new Error('Balance too low to cover gas');

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
        fundingTxHash:   '',
        fromAddress:     address,
        toAddress:       this.hotWalletAddress,
        amount:          ethers.formatEther(sendAmount),
        gasFee:          ethers.formatEther(gasCostWei),
        derivationIndex: index,
        status:          'completed',
      }));

      this.logger.log(`Sweep complete for ${address}: ${sweepTx.hash}`);
      return { address, txHash: sweepTx.hash, status: 'completed' };
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

      return { address, txHash: '', status: 'failed', error: err.message };
    }
  }

  async getSweepStatus(txHash: string): Promise<SweepTransaction | null> {
    return this.sweepTxRepo.findOne({ where: { txHash } });
  }

  /**
   * Current native EXBT balance of the hot wallet. Used by Laravel to monitor that the
   * hot wallet is funded enough to cover withdrawals and sweep gas.
   */
  async getHotWalletBalance(): Promise<{
    address: string;
    balance: string;
    balance_wei: string;
    chain_id: number;
  }> {
    const key = this.configService.get<string>('EXBT_HOT_WALLET_KEY');
    if (!key || key.startsWith('0x_YOUR')) {
      throw new ServiceUnavailableException('EXBT_HOT_WALLET_KEY is not configured');
    }

    const address    = this.hotWalletAddress;
    const balanceWei = await this.provider.getBalance(address);

    return {
      address,
      balance:     ethers.formatEther(balanceWei),
      balance_wei: balanceWei.toString(),
      chain_id:    parseInt(this.configService.get<string>('EXBT_CHAIN_ID', '11211')),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
