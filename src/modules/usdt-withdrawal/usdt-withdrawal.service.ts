import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
  NotFoundException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import * as crypto from 'crypto';
import axios from 'axios';
import { UsdtWithdrawal } from '../../entities';

const BSC_CHAIN_ID = 56;
const USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
const USDT_DECIMALS = 18;
const USDT_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

@Injectable()
export class UsdtWithdrawalService implements OnModuleInit {
  private readonly logger = new Logger(UsdtWithdrawalService.name);
  private _provider: ethers.JsonRpcProvider;
  private _hotWallet: ethers.Wallet;
  private webhookUrl: string;
  private webhookSecret: string;

  constructor(
    @InjectRepository(UsdtWithdrawal)
    private repo: Repository<UsdtWithdrawal>,
    private configService: ConfigService,
  ) {
    this.webhookUrl = `${this.configService.get('LARAVEL_URL')}/api/v1/withdrawals/webhook`;
    this.webhookSecret = this.configService.get<string>('LARAVEL_API_SECRET');
  }

  onModuleInit() {
    const key    = this.configService.get<string>('USDT_HOT_WALLET_KEY');
    const rpcUrl = this.configService.get<string>('BSC_RPC_URL');

    if (!rpcUrl) {
      this.logger.warn('BSC_RPC_URL not configured — USDT withdrawals will not work');
    } else if (!key) {
      this.logger.warn('USDT_HOT_WALLET_KEY not configured — USDT withdrawals will not work');
    } else {
      this.logger.log(`USDT hot wallet ready: ${this.hotWallet.address} (BSC BEP-20)`);
    }

    this.startRetryLoop().catch(err =>
      this.logger.error(`Webhook retry loop crashed: ${err.message}`),
    );
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async request(userId: number, toAddress: string, amount: string): Promise<UsdtWithdrawal> {
    if (!ethers.isAddress(toAddress)) {
      throw new BadRequestException('Invalid to_address');
    }
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      throw new BadRequestException('Invalid amount: must be a positive number');
    }

    const record = await this.repo.save(
      this.repo.create({ userId, toAddress, amount, status: 'pending' }),
    );

    this.broadcast(record.id).catch(err =>
      this.logger.error(`Broadcast error for ${record.id}: ${err.message}`),
    );

    return record;
  }

  async getStatus(id: string): Promise<UsdtWithdrawal> {
    const record = await this.repo.findOne({ where: { id } });
    if (!record) throw new NotFoundException('Withdrawal not found');
    return record;
  }

  // ─── Async broadcast ─────────────────────────────────────────────────────

  private async broadcast(id: string) {
    const record = await this.repo.findOne({ where: { id } });
    await this.repo.update(id, { status: 'processing' });

    try {
      const amountWei = ethers.parseUnits(record.amount.toString(), USDT_DECIMALS);
      const wallet    = this.hotWallet;
      const usdt      = new ethers.Contract(USDT_CONTRACT, USDT_ABI, wallet);

      let feeData: ethers.FeeData;
      let bnbBalance: bigint;
      let usdtBalance: bigint;

      try {
        [feeData, bnbBalance, usdtBalance] = await Promise.all([
          this.provider.getFeeData(),
          this.provider.getBalance(wallet.address),
          usdt.balanceOf(wallet.address),
        ]);
      } catch (err) {
        this.throwIfRpcError(err);
        throw err;
      }

      if (usdtBalance < amountWei) {
        const have = ethers.formatUnits(usdtBalance, USDT_DECIMALS);
        throw new Error(
          `Insufficient USDT balance: hot wallet has ${have} USDT, requested ${record.amount} USDT`,
        );
      }

      let gasEstimate: bigint;
      try {
        gasEstimate = await usdt.transfer.estimateGas(record.toAddress, amountWei);
      } catch (err) {
        this.throwIfRpcError(err);
        throw err;
      }

      const gasLimit   = (gasEstimate * 120n) / 100n;
      const gasPrice   = feeData.gasPrice ?? feeData.maxFeePerGas;
      const gasCostWei = gasLimit * gasPrice;

      if (bnbBalance < gasCostWei) {
        const have = ethers.formatEther(bnbBalance);
        const need = ethers.formatEther(gasCostWei);
        throw new Error(
          `Insufficient BNB for gas: hot wallet has ${have} BNB, estimated gas cost ${need} BNB`,
        );
      }

      let tx: ethers.ContractTransactionResponse;
      let receipt: ethers.ContractTransactionReceipt;

      try {
        tx      = await usdt.transfer(record.toAddress, amountWei, { gasLimit, gasPrice });
        receipt = await tx.wait(1);
      } catch (err) {
        this.throwIfRpcError(err);
        throw err;
      }

      const gasFee = ethers.formatEther(BigInt(receipt.gasUsed) * gasPrice);

      await this.repo.update(id, {
        status:      'completed',
        txHash:      tx.hash,
        gasFee,
        completedAt: new Date(),
      });

      this.logger.log(`Sent ${record.amount} USDT → ${record.toAddress} | tx ${tx.hash}`);

      await this.notifyLaravel(id, {
        event:         'usdt_withdrawal.completed',
        user_id:       record.userId,
        withdrawal_id: id,
        to_address:    record.toAddress,
        amount:        record.amount,
        tx_hash:       tx.hash,
        gas_fee:       gasFee,
        network:       'bsc',
        token:         'USDT',
      });
    } catch (err) {
      this.logger.error(`Failed ${id}: ${err.message}`);

      await this.repo.update(id, {
        status:       'failed',
        errorMessage: err.message,
      });

      const fresh = await this.repo.findOne({ where: { id } });
      await this.notifyLaravel(id, {
        event:         'usdt_withdrawal.failed',
        user_id:       fresh.userId,
        withdrawal_id: id,
        to_address:    fresh.toAddress,
        amount:        fresh.amount,
        error:         err.message,
        network:       'bsc',
        token:         'USDT',
      });
    }
  }

  // ─── Webhook ──────────────────────────────────────────────────────────────

  private async notifyLaravel(id: string, payload: object) {
    const jsonPayload = JSON.stringify(payload);
    const signature   = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(jsonPayload)
      .digest('hex');

    this.logger.log(
      `[WEBHOOK] Sending → ${this.webhookUrl} | id=${id} | ${jsonPayload}`,
    );

    try {
      const res = await axios.post(this.webhookUrl, jsonPayload, {
        headers: { 'X-Signature': signature, 'Content-Type': 'application/json' },
        timeout: 10_000,
      });
      this.logger.log(`[WEBHOOK] Delivered ${id} — ${res.status} ${res.statusText}`);
      await this.repo.update(id, { webhookStatus: 'delivered' });
    } catch (err) {
      this.logger.error(
        `[WEBHOOK] Failed ${id}: ${err.message} — will retry in 60s`,
      );
      await this.repo.update(id, { webhookError: err.message });
    }
  }

  // ─── Retry loop ───────────────────────────────────────────────────────────

  private async startRetryLoop() {
    while (true) {
      await this.sleep(60_000);
      try {
        const pending = await this.repo.find({
          where: [
            { webhookStatus: 'pending', status: 'completed' },
            { webhookStatus: 'pending', status: 'failed' },
          ],
        });
        if (pending.length === 0) continue;
        this.logger.log(`Retrying ${pending.length} pending webhook(s)...`);
        for (const w of pending) {
          await this.notifyLaravel(w.id, this.buildRetryPayload(w));
        }
      } catch (err) {
        this.logger.error(`Retry loop error: ${err.message}`);
      }
    }
  }

  private buildRetryPayload(w: UsdtWithdrawal): object {
    if (w.status === 'completed') {
      return {
        event:         'usdt_withdrawal.completed',
        user_id:       w.userId,
        withdrawal_id: w.id,
        to_address:    w.toAddress,
        amount:        w.amount,
        tx_hash:       w.txHash,
        gas_fee:       w.gasFee,
        network:       'bsc',
        token:         'USDT',
      };
    }
    return {
      event:         'usdt_withdrawal.failed',
      user_id:       w.userId,
      withdrawal_id: w.id,
      to_address:    w.toAddress,
      amount:        w.amount,
      error:         w.errorMessage,
      network:       'bsc',
      token:         'USDT',
    };
  }

  // ─── Providers (lazy) ─────────────────────────────────────────────────────

  private get provider(): ethers.JsonRpcProvider {
    if (!this._provider) {
      const rpcUrl = this.configService.get<string>('BSC_RPC_URL');
      if (!rpcUrl) throw new ServiceUnavailableException('BSC_RPC_URL is not configured');
      this._provider = new ethers.JsonRpcProvider(
        rpcUrl,
        { chainId: BSC_CHAIN_ID, name: 'bsc' },
        { staticNetwork: true },
      );
    }
    return this._provider;
  }

  private get hotWallet(): ethers.Wallet {
    if (!this._hotWallet) {
      const key = this.configService.get<string>('USDT_HOT_WALLET_KEY');
      if (!key) throw new ServiceUnavailableException('USDT_HOT_WALLET_KEY is not configured');
      this._hotWallet = new ethers.Wallet(key, this.provider);
    }
    return this._hotWallet;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private throwIfRpcError(err: any): void {
    const msg: string  = err?.message ?? '';
    const code: string = err?.code ?? '';

    const isRpc =
      code === 'NETWORK_ERROR' ||
      code === 'SERVER_ERROR'  ||
      code === 'TIMEOUT'       ||
      msg.includes('ECONNREFUSED')             ||
      msg.includes('ETIMEDOUT')                ||
      msg.includes('ENOTFOUND')                ||
      msg.includes('could not detect network') ||
      msg.includes('failed to meet quorum');

    if (isRpc) {
      throw new ServiceUnavailableException(
        `BSC RPC unavailable — please try again later. (${msg})`,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
