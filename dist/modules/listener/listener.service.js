"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListenerService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const config_1 = require("@nestjs/config");
const ethers_1 = require("ethers");
const crypto = require("crypto");
const axios_1 = require("axios");
const entities_1 = require("../../entities");
let ListenerService = class ListenerService {
    constructor(processedDepositRepo, networkSyncStateRepo, configService) {
        this.processedDepositRepo = processedDepositRepo;
        this.networkSyncStateRepo = networkSyncStateRepo;
        this.configService = configService;
        this.monitoredAddresses = new Map();
        this.isRunning = false;
        const rpcUrl = this.configService.get('EXBT_RPC_URL');
        const chainId = parseInt(this.configService.get('EXBT_CHAIN_ID', '11211'));
        this.provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl, { chainId, name: 'exbt-testnet' });
        this.laravelWebhookUrl = `${this.configService.get('LARAVEL_URL')}/api/v1/deposits/webhook`;
        this.laravelApiSecret = this.configService.get('LARAVEL_API_SECRET');
        this.pollIntervalMs = parseInt(this.configService.get('SCANNER_POLL_INTERVAL_MS', '12000'));
    }
    async startListener(addresses) {
        if (this.isRunning) {
            console.log('[Listener] Already running — skipping duplicate start');
            return;
        }
        this.monitoredAddresses.clear();
        for (const addr of addresses) {
            this.monitoredAddresses.set(addr.address.toLowerCase(), addr.user_id);
        }
        this.isRunning = true;
        console.log(`[Listener] Starting — monitoring ${addresses.length} addresses`);
        while (true) {
            try {
                await this.scanBlocks();
            }
            catch (err) {
                console.error('[Listener] Scan error:', err.message);
            }
            await this.sleep(this.pollIntervalMs);
        }
    }
    registerAddress(userId, address) {
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
    async scanBlocks() {
        const cursor = await this.getCursor();
        const latest = await this.withRetry(() => this.provider.getBlockNumber(), 'getBlockNumber');
        if (cursor >= latest)
            return;
        const from = cursor + 1;
        const to = Math.min(latest, cursor + 50);
        console.log(`[Listener] Scanning blocks ${from}–${to} (${this.monitoredAddresses.size} addresses watched)`);
        for (let blockNum = from; blockNum <= to; blockNum++) {
            let block;
            try {
                block = await this.withRetry(() => this.provider.getBlock(blockNum, false), `getBlock(${blockNum})`);
            }
            catch (err) {
                console.error(`[Listener] Skipping block ${blockNum}: ${err.message}`);
                await this.updateCursor(blockNum);
                continue;
            }
            if (block?.transactions?.length > 0) {
                await this.processBlock(block);
            }
            await this.updateCursor(blockNum);
        }
    }
    async processBlock(block) {
        for (const txHash of block.transactions) {
            let tx;
            try {
                tx = await this.withRetry(() => this.provider.getTransaction(txHash), 'getTransaction');
            }
            catch {
                continue;
            }
            if (!tx?.to)
                continue;
            const toLower = tx.to.toLowerCase();
            if (!this.monitoredAddresses.has(toLower))
                continue;
            if (!tx.value || tx.value === 0n)
                continue;
            const userId = this.monitoredAddresses.get(toLower);
            await this.processDeposit(tx, block.number, userId).catch(err => console.error(`[Listener] Error processing ${txHash}:`, err.message));
        }
    }
    async processDeposit(tx, blockNumber, userId) {
        const existing = await this.processedDepositRepo.findOne({ where: { txHash: tx.hash } });
        if (existing)
            return;
        const amount = ethers_1.ethers.formatEther(tx.value);
        const payload = {
            user_id: userId,
            network: 'exbt',
            coin_symbol: 'EXBT',
            amount: parseFloat(amount),
            from_address: tx.from?.toLowerCase(),
            to_address: tx.to?.toLowerCase(),
            tx_hash: tx.hash,
            confirmations: 1,
            block_number: blockNumber,
            timestamp: Math.floor(Date.now() / 1000),
        };
        await this.notifyLaravel(payload, tx.hash, userId, tx.to?.toLowerCase(), amount, blockNumber);
    }
    async notifyLaravel(payload, txHash, userId, address, amount, blockNumber) {
        const jsonPayload = JSON.stringify(payload);
        const signature = crypto
            .createHmac('sha256', this.laravelApiSecret)
            .update(jsonPayload)
            .digest('hex');
        try {
            await axios_1.default.post(this.laravelWebhookUrl, jsonPayload, {
                headers: { 'X-Signature': signature, 'Content-Type': 'application/json' },
                timeout: 10000,
            });
            await this.processedDepositRepo.save(this.processedDepositRepo.create({
                txHash,
                userId,
                address,
                amount,
                blockNumber,
            }));
            console.log(`[Listener] Credited ${amount} EXBT to user ${userId} — tx ${txHash.slice(0, 12)}...`);
        }
        catch (err) {
            console.error('[Listener] Webhook failed:', err.message, '— will retry next cycle');
        }
    }
    async getCursor() {
        const startBlock = parseInt(this.configService.get('SCANNER_START_BLOCK', '0'));
        if (startBlock > 0)
            return startBlock - 1;
        const state = await this.networkSyncStateRepo.findOne({ where: { network: 'exbt' } });
        return state ? Number(state.lastProcessedBlock) : 0;
    }
    async updateCursor(blockNumber) {
        await this.networkSyncStateRepo.upsert({ network: 'exbt', lastProcessedBlock: blockNumber }, ['network']);
    }
    async withRetry(fn, label, retries = 3) {
        let delay = 1000;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await fn();
            }
            catch (err) {
                if (attempt === retries)
                    throw err;
                console.warn(`[Listener] ${label} attempt ${attempt} failed — retry in ${delay}ms`);
                await this.sleep(delay);
                delay *= 2;
            }
        }
    }
    sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
};
exports.ListenerService = ListenerService;
exports.ListenerService = ListenerService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.ProcessedDeposit)),
    __param(1, (0, typeorm_1.InjectRepository)(entities_1.NetworkSyncState)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        config_1.ConfigService])
], ListenerService);
//# sourceMappingURL=listener.service.js.map