import { Injectable, OnModuleInit, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import axios from 'axios';
import { SweepTransaction, WalletAddress } from '../../entities';
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
    @InjectRepository(WalletAddress)
    private walletAddressRepo: Repository<WalletAddress>,
    private walletService: WalletService,
    private encryptionService: EncryptionService,
    private configService: ConfigService,
  ) {}

  private get provider(): ethers.JsonRpcProvider {
    if (!this._provider) {
      const rpcUrl  = this.configService.get<string>('EXBT_RPC_URL');
      const chainId = parseInt(this.configService.get<string>('EXBT_CHAIN_ID', '11211'));
      this._provider = new ethers.JsonRpcProvider(rpcUrl, { chainId, name: 'exbt-testnet' }, { staticNetwork: true });
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
  private readonly DB_PAGE_SIZE = 500;

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
   * Paginate through exbt_wallet_addresses in DB_PAGE_SIZE chunks.
   * Returns all address+derivationIndex pairs without loading the entire table at once.
   */
  private async loadAddressesFromDb(): Promise<{ address: string; index: number }[]> {
    const all: { address: string; index: number }[] = [];
    let skip = 0;

    while (true) {
      const rows = await this.walletAddressRepo.find({
        select: ['address', 'derivationIndex'],
        skip,
        take: this.DB_PAGE_SIZE,
        order: { derivationIndex: 'ASC' },
      });
      if (rows.length === 0) break;
      for (const r of rows) all.push({ address: r.address, index: r.derivationIndex });
      if (rows.length < this.DB_PAGE_SIZE) break;
      skip += this.DB_PAGE_SIZE;
    }

    return all;
  }

  /**
   * Batch-fetch balances for the given address list, return only those above minWei.
   */
  private async scanAddresses(
    addresses: { address: string; index: number }[],
    minWei: bigint,
  ): Promise<AddressWithBalance[]> {
    const chunks: typeof addresses[] = [];
    for (let i = 0; i < addresses.length; i += this.BATCH_SIZE) {
      chunks.push(addresses.slice(i, i + this.BATCH_SIZE));
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
   * Fetch all addresses from DB and return those with balance above minBalance.
   * Phase 1 of the sweep flow — called before execution so admin can review.
   */
  async estimateSweep(
    encryptedMnemonic: EncryptedData,
    minBalance = '0.001',
  ) {
    const masterPassword = this.configService.get<string>('MASTER_PASSWORD');
    this.encryptionService.decrypt(encryptedMnemonic, masterPassword); // validate mnemonic decrypts
    const minWei = ethers.parseEther(minBalance);

    const dbAddresses = await this.loadAddressesFromDb();
    this.logger.log(`Scanning ${dbAddresses.length} DB addresses for balance >= ${minBalance} EXBT (batched)`);

    const addressesWithBalance = await this.scanAddresses(dbAddresses, minWei);

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
   * Fetch all addresses from DB, scan balances, then sweep to hot wallet.
   */
  async executeSweep(
    encryptedMnemonic: EncryptedData,
    minBalance = '0.001',
  ): Promise<{ scanned: number; swept: number; results: SweepResult[] }> {
    const masterPassword = this.configService.get<string>('MASTER_PASSWORD');
    const mnemonic       = this.encryptionService.decrypt(encryptedMnemonic, masterPassword);
    const minWei         = ethers.parseEther(minBalance);

    const dbAddresses = await this.loadAddressesFromDb();
    const scanned     = dbAddresses.length;

    this.logger.log(`Scanning ${scanned} DB addresses (batched) then sweeping to hot wallet...`);

    const addressesWithBalance = await this.scanAddresses(dbAddresses, minWei);

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
