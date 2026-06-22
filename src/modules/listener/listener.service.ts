import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import * as crypto from 'crypto';
import axios from 'axios';
import { ProcessedDeposit, NetworkSyncState, ScannedBlock } from '../../entities';

@Injectable()
export class ListenerService {
  private provider: ethers.JsonRpcProvider;
  private monitoredAddresses: Map<string, number> = new Map(); // lowercase address → userId
  private isRunning = false;
  private laravelWebhookUrl: string;
  private laravelApiSecret: string;
  private pollIntervalMs: number;
  private confirmationDepth: number;

  constructor(
    @InjectRepository(ProcessedDeposit)
    private processedDepositRepo: Repository<ProcessedDeposit>,
    @InjectRepository(NetworkSyncState)
    private networkSyncStateRepo: Repository<NetworkSyncState>,
    @InjectRepository(ScannedBlock)
    private scannedBlockRepo: Repository<ScannedBlock>,
    private configService: ConfigService,
  ) {
    const rpcUrl  = this.configService.get<string>('EXBT_RPC_URL');
    const chainId = parseInt(this.configService.get<string>('EXBT_CHAIN_ID', '11211'));
    this.provider = new ethers.JsonRpcProvider(rpcUrl, { chainId, name: 'exbt-testnet' }, { staticNetwork: true });

    this.laravelWebhookUrl    = `${this.configService.get('LARAVEL_URL')}/api/v1/deposits/webhook`;
    this.laravelApiSecret     = this.configService.get<string>('LARAVEL_API_SECRET');
    this.pollIntervalMs       = parseInt(this.configService.get<string>('SCANNER_POLL_INTERVAL_MS', '60000'));
    this.confirmationDepth    = parseInt(this.configService.get<string>('SCANNER_CONFIRMATION_DEPTH', '12'));
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async startListener(addresses: Array<{ user_id: number; address: string }>) {
    if (this.isRunning) {
      console.log('[Listener] Already running — skipping duplicate start');
      return;
    }

    this.monitoredAddresses.clear();
    for (const addr of addresses) {
      this.monitoredAddresses.set(addr.address.toLowerCase(), addr.user_id);
    }

    this.isRunning = true;
    console.log(`[Listener] Starting — monitoring ${this.monitoredAddresses.size} addresses`);

    while (true) {
      try {
        await this.retryPendingWebhooks(); // retry failed webhooks first
        await this.checkDeposits();
      } catch (err) {
        console.error('[Listener] Poll error:', err.message);
      }
      console.log(`[Listener] Next check in ${this.pollIntervalMs / 1000}s`);
      await this.sleep(this.pollIntervalMs);
    }
  }

  registerAddress(userId: number, address: string) {
    this.monitoredAddresses.set(address.toLowerCase(), userId);
    console.log(`[Listener] Registered ${address} for user ${userId}`);

    if (!this.isRunning) {
      const list = Array.from(this.monitoredAddresses.entries()).map(([a, u]) => ({
        user_id: u,
        address: a,
      }));
      this.startListener(list).catch(err => {
        console.error('[Listener] Crashed:', err.message);
        this.isRunning = false;
      });
    }
  }

  // ─── Core logic ───────────────────────────────────────────────────────────

  private async checkDeposits() {
    if (this.monitoredAddresses.size === 0) return;

    const latest     = await this.withRetry(
      () => this.provider.getBlockNumber(),
      'getBlockNumber',
    );
    const safeLatest = latest - this.confirmationDepth;

    const cursor = await this.getCursor();
    if (cursor >= safeLatest) return;

    const from = cursor + 1;
    const to   = Math.min(safeLatest, cursor + 50); // max 50 blocks per tick — catches up gradually

    if (from < safeLatest - 50) {
      console.log(`[Listener] Catching up — ${safeLatest - cursor} blocks behind, processing ${from}–${to}...`);
    } else {
      console.log(`[Listener] Checking blocks ${from}–${to} (confirmed, ${this.confirmationDepth} behind head) for ${this.monitoredAddresses.size} addresses...`);
    }

    for (let blockNum = from; blockNum <= to; blockNum++) {
      let block: any;
      try {
        block = await this.withRetry(
          () => this.provider.getBlock(blockNum, false),
          `getBlock(${blockNum})`,
        );
      } catch (err) {
        // Do NOT move cursor forward on RPC failure
        // Block will be retried on next cycle
        console.error(`[Listener] RPC error on block ${blockNum}: ${err.message} — will retry next cycle`);
        return;
      }

      if (!block) {
        console.warn(`[Listener] Block ${blockNum} returned null — will retry next cycle`);
        return; // stop this tick, retry same block next cycle
      }

      const depositCount = block.transactions?.length > 0
        ? await this.processBlock(block)
        : 0;

      await this.scannedBlockRepo.upsert(
        {
          blockNumber:  blockNum,
          txCount:      block.transactions?.length ?? 0,
          depositCount,
        },
        ['blockNumber'],
      );

      await this.updateCursor(blockNum);
    }
  }

  private async processBlock(block: any): Promise<number> {
    let depositCount = 0;

    for (const txHash of block.transactions) {
      let tx: any;
      try {
        tx = await this.withRetry(
          () => this.provider.getTransaction(txHash),
          'getTransaction',
        );
      } catch {
        continue;
      }

      if (!tx?.to || !tx.value || tx.value === 0n) continue;

      const toLower = tx.to.toLowerCase();
      if (!this.monitoredAddresses.has(toLower)) continue;

      const alreadyProcessed = await this.processedDepositRepo.findOne({
        where: { txHash: tx.hash },
      });
      if (alreadyProcessed) continue;

      const userId = this.monitoredAddresses.get(toLower);
      await this.processDeposit(tx, block.number, userId).catch(err =>
        console.error(`[Listener] Error processing ${tx.hash}:`, err.message),
      );
      depositCount++;
    }

    return depositCount;
  }

  // ─── Deposit processing & webhook ─────────────────────────────────────────

  private async processDeposit(tx: any, blockNumber: number, userId: number) {
    const amount = ethers.formatEther(tx.value);

    console.log(`[Listener] Deposit detected — ${amount} EXBT to user ${userId} — tx ${tx.hash.slice(0, 12)}...`);

    const payload = {
      user_id:      userId,
      network:      'exbt',
      coin_symbol:  'EXBT',
      amount:       parseFloat(amount),
      from_address: tx.from?.toLowerCase(),
      to_address:   tx.to?.toLowerCase(),
      tx_hash:      tx.hash,
      confirmations: 1,
      block_number: blockNumber,
      timestamp:    Math.floor(Date.now() / 1000),
    };

    const jsonPayload = JSON.stringify(payload);

    // Save to DB first with status='pending' — cursor already moved forward
    // so we must persist before attempting webhook to avoid losing on restart
    await this.processedDepositRepo.save(
      this.processedDepositRepo.create({
        txHash:      tx.hash,
        userId,
        address:     tx.to?.toLowerCase(),
        amount,
        blockNumber,
        status:      'pending',
        rawPayload:  jsonPayload,
      }),
    );

    await this.sendWebhook(tx.hash, jsonPayload);
  }

  private async sendWebhook(txHash: string, jsonPayload: string) {
    const signature = crypto
      .createHmac('sha256', this.laravelApiSecret)
      .update(jsonPayload)
      .digest('hex');

    console.log(
      `[Listener][WEBHOOK] Sending deposit webhook\n` +
      `  URL:     ${this.laravelWebhookUrl}\n` +
      `  TX Hash: ${txHash}\n` +
      `  Payload: ${jsonPayload}`
    );

    try {
      const response = await axios.post(this.laravelWebhookUrl, jsonPayload, {
        headers: { 'X-Signature': signature, 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      console.log(
        `[Listener][WEBHOOK] Deposit webhook success\n` +
        `  URL:    ${this.laravelWebhookUrl}\n` +
        `  Status: ${response.status} ${response.statusText}\n` +
        `  TX:     ${txHash}\n` +
        `  Body:   ${JSON.stringify(response.data)}`
      );

      // Mark as processed after successful webhook
      await this.processedDepositRepo.update({ txHash }, { status: 'processed' });

      const payload = JSON.parse(jsonPayload);
      console.log(`[Listener] Webhook sent — ${payload.amount} EXBT to user ${payload.user_id}`);
    } catch (err) {
      const httpStatus  = err.response?.status;
      const httpBody    = err.response?.data;
      const httpHeaders = err.response?.headers;

      console.error(
        `[Listener][WEBHOOK] Deposit webhook FAILED\n` +
        `  URL:              ${this.laravelWebhookUrl}\n` +
        `  TX Hash:          ${txHash}\n` +
        `  Error:            ${err.message}\n` +
        `  HTTP Status:      ${httpStatus ?? 'no response'}\n` +
        `  Response Body:    ${httpBody ? JSON.stringify(httpBody) : 'none'}\n` +
        `  Response Headers: ${httpHeaders ? JSON.stringify(httpHeaders) : 'none'}\n` +
        `  Payload:          ${jsonPayload}`
      );
      // Status stays 'pending' → picked up by retryPendingWebhooks next cycle
    }
  }

  private async retryPendingWebhooks() {
    const pending = await this.processedDepositRepo.find({ where: { status: 'pending' } });
    if (pending.length === 0) return;

    console.log(`[Listener] Retrying ${pending.length} pending webhook(s)...`);
    for (const deposit of pending) {
      await this.sendWebhook(deposit.txHash, deposit.rawPayload);
    }
  }

  // ─── Cursor ───────────────────────────────────────────────────────────────

  private async getCursor(): Promise<number> {
    const startBlock = parseInt(this.configService.get<string>('SCANNER_START_BLOCK', '0'));
    if (startBlock > 0) return startBlock - 1;
    const state = await this.networkSyncStateRepo.findOne({ where: { network: 'exbt' } });
    return state ? Number(state.lastProcessedBlock) : 0;
  }

  private async updateCursor(blockNumber: number) {
    await this.networkSyncStateRepo.upsert(
      { network: 'exbt', lastProcessedBlock: blockNumber },
      ['network'],
    );
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private async withRetry<T>(fn: () => Promise<T>, label: string, retries = 3): Promise<T> {
    let delay = 1000;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt === retries) throw err;
        console.warn(`[Listener] ${label} attempt ${attempt} failed — retry in ${delay}ms`);
        await this.sleep(delay);
        delay *= 2;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
