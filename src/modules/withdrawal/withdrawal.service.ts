import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import * as crypto from 'crypto';
import axios from 'axios';
import { Withdrawal } from '../../entities';

@Injectable()
export class WithdrawalService implements OnModuleInit {
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

  onModuleInit() {
    this.startRetryLoop().catch(err =>
      console.error('[Withdrawal] Retry loop crashed:', err.message),
    );
  }

  private async startRetryLoop() {
    while (true) {
      await this.sleep(60_000);
      try {
        await this.retryPendingWebhooks();
      } catch (err) {
        console.error('[Withdrawal] Retry error:', err.message);
      }
    }
  }

  private async retryPendingWebhooks() {
    const pending = await this.withdrawalRepo.find({
      where: [
        { webhookStatus: 'pending', status: 'completed' },
        { webhookStatus: 'pending', status: 'failed' },
      ],
    });
    if (pending.length === 0) return;

    console.log(`[Withdrawal] Retrying ${pending.length} pending webhook(s)...`);
    for (const w of pending) {
      await this.notifyLaravel(w.id, this.buildPayload(w));
    }
  }

  private buildPayload(w: Withdrawal): object {
    if (w.status === 'completed') {
      return {
        event:         'withdrawal.completed',
        user_id:       w.userId,
        withdrawal_id: w.id,
        amount:        w.amount,
        tx_hash:       w.txHash,
        gas_fee:       w.gasFee,
      };
    }
    return {
      event:         'withdrawal.failed',
      user_id:       w.userId,
      withdrawal_id: w.id,
      amount:        w.amount,
      error:         w.errorMessage,
    };
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

      await this.notifyLaravel(withdrawalId, {
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

      await this.notifyLaravel(withdrawalId, {
        event:         'withdrawal.failed',
        user_id:       withdrawal.userId,
        withdrawal_id: withdrawal.id,
        amount:        withdrawal.amount,
        error:         err.message,
      });
    }
  }

  // ─── Laravel webhook ─────────────────────────────────────────────────────

  private async notifyLaravel(withdrawalId: string, payload: object) {
    const jsonPayload = JSON.stringify(payload);
    const signature   = crypto
      .createHmac('sha256', this.laravelApiSecret)
      .update(jsonPayload)
      .digest('hex');

    console.log(
      `[Withdrawal][WEBHOOK] Sending withdrawal webhook\n` +
      `  URL:           ${this.laravelWebhookUrl}\n` +
      `  Withdrawal ID: ${withdrawalId}\n` +
      `  Payload:       ${jsonPayload}`
    );

    try {
      const response = await axios.post(this.laravelWebhookUrl, jsonPayload, {
        headers: { 'X-Signature': signature, 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      console.log(
        `[Withdrawal][WEBHOOK] Withdrawal webhook success\n` +
        `  URL:           ${this.laravelWebhookUrl}\n` +
        `  Withdrawal ID: ${withdrawalId}\n` +
        `  Status:        ${response.status} ${response.statusText}\n` +
        `  Body:          ${JSON.stringify(response.data)}`
      );

      await this.withdrawalRepo.update(withdrawalId, { webhookStatus: 'delivered' });
      console.log(`[Withdrawal] Webhook delivered for ${withdrawalId}`);
    } catch (err) {
      const httpStatus  = err.response?.status;
      const httpBody    = err.response?.data;
      const httpHeaders = err.response?.headers;

      console.error(
        `[Withdrawal][WEBHOOK] Withdrawal webhook FAILED\n` +
        `  URL:              ${this.laravelWebhookUrl}\n` +
        `  Withdrawal ID:    ${withdrawalId}\n` +
        `  Error:            ${err.message}\n` +
        `  HTTP Status:      ${httpStatus ?? 'no response'}\n` +
        `  Response Body:    ${httpBody ? JSON.stringify(httpBody) : 'none'}\n` +
        `  Response Headers: ${httpHeaders ? JSON.stringify(httpHeaders) : 'none'}\n` +
        `  Payload:          ${jsonPayload}`
      );
      console.error(`[Withdrawal] Webhook failed for ${withdrawalId}: ${err.message} — will retry in 60s`);
      await this.withdrawalRepo.update(withdrawalId, { webhookError: err.message });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
