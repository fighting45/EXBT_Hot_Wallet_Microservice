import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import * as crypto from 'crypto';
import axios from 'axios';
import { Withdrawal } from '../../entities';

@Injectable()
export class WithdrawalService {
  private _provider: ethers.JsonRpcProvider;
  private _hotWallet: ethers.Wallet;
  private laravelWebhookUrl: string;
  private laravelApiSecret: string;

  constructor(
    @InjectRepository(Withdrawal)
    private withdrawalRepo: Repository<Withdrawal>,
    private configService: ConfigService,
  ) {
    this.laravelWebhookUrl = `${this.configService.get('LARAVEL_URL')}/api/v1/withdrawals/webhook`;
    this.laravelApiSecret  = this.configService.get<string>('LARAVEL_API_SECRET');
  }

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

  async request(userId: number, toAddress: string, amount: string): Promise<Withdrawal> {
    if (!ethers.isAddress(toAddress)) {
      throw new BadRequestException('Invalid to_address');
    }

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      throw new BadRequestException('Invalid amount');
    }

    const withdrawal = await this.withdrawalRepo.save(
      this.withdrawalRepo.create({ userId, toAddress, amount, status: 'pending' }),
    );

    // Broadcast asynchronously — don't block the HTTP response
    this.broadcast(withdrawal.id).catch(err =>
      console.error(`[Withdrawal] Broadcast error for ${withdrawal.id}:`, err.message),
    );

    return withdrawal;
  }

  async getStatus(withdrawalId: string): Promise<Withdrawal | null> {
    return this.withdrawalRepo.findOne({ where: { id: withdrawalId } });
  }

  // ─── Broadcast ────────────────────────────────────────────────────────────

  private async broadcast(withdrawalId: string) {
    const withdrawal = await this.withdrawalRepo.findOne({ where: { id: withdrawalId } });
    await this.withdrawalRepo.update(withdrawalId, { status: 'processing' });

    try {
      const amountWei   = ethers.parseEther(withdrawal.amount.toString());
      const feeData     = await this.provider.getFeeData();
      const gasPrice    = feeData.gasPrice;
      const gasEstimate = await this.provider.estimateGas({
        to:    withdrawal.toAddress,
        value: amountWei,
        from:  this.hotWallet.address,
      });
      const gasLimit   = gasEstimate * 120n / 100n;
      const gasCostWei = gasLimit * gasPrice;

      // Check hot wallet balance
      const hotBalance = await this.provider.getBalance(this.hotWallet.address);
      if (hotBalance < amountWei + gasCostWei) {
        throw new Error('Hot wallet has insufficient funds to process this withdrawal');
      }

      const sendWei = amountWei - gasCostWei;
      if (sendWei <= 0n) throw new Error('Amount too small to cover gas');

      const tx = await this.hotWallet.sendTransaction({
        to:       withdrawal.toAddress,
        value:    sendWei,
        gasLimit,
        gasPrice,
      });
      await tx.wait(1);

      const gasFeeEth = ethers.formatEther(gasCostWei);

      await this.withdrawalRepo.update(withdrawalId, {
        status:      'completed',
        txHash:      tx.hash,
        gasFee:      gasFeeEth,
        completedAt: new Date(),
      });

      await this.notifyLaravel({
        event:         'withdrawal.completed',
        user_id:       withdrawal.userId,
        withdrawal_id: withdrawal.id,
        amount:        withdrawal.amount,
        tx_hash:       tx.hash,
        gas_fee:       gasFeeEth,
      });

      console.log(`[Withdrawal] Completed ${withdrawal.id} — tx ${tx.hash.slice(0, 12)}...`);
    } catch (err) {
      console.error(`[Withdrawal] Failed ${withdrawalId}:`, err.message);

      await this.withdrawalRepo.update(withdrawalId, {
        status:       'failed',
        errorMessage: err.message,
      });

      await this.notifyLaravel({
        event:         'withdrawal.failed',
        user_id:       withdrawal.userId,
        withdrawal_id: withdrawal.id,
        amount:        withdrawal.amount,
        error:         err.message,
      });
    }
  }

  // ─── Laravel webhook ─────────────────────────────────────────────────────

  private async notifyLaravel(payload: any) {
    const jsonPayload = JSON.stringify(payload);
    const signature   = crypto
      .createHmac('sha256', this.laravelApiSecret)
      .update(jsonPayload)
      .digest('hex');

    try {
      await axios.post(this.laravelWebhookUrl, jsonPayload, {
        headers: { 'X-Signature': signature, 'Content-Type': 'application/json' },
        timeout: 10000,
      });
    } catch (err) {
      console.error('[Withdrawal] Webhook failed:', err.message);
    }
  }
}
