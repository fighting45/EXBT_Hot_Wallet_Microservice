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
exports.WithdrawalService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const config_1 = require("@nestjs/config");
const ethers_1 = require("ethers");
const crypto = require("crypto");
const axios_1 = require("axios");
const entities_1 = require("../../entities");
let WithdrawalService = class WithdrawalService {
    constructor(withdrawalRepo, configService) {
        this.withdrawalRepo = withdrawalRepo;
        this.configService = configService;
        const rpcUrl = this.configService.get('EXBT_RPC_URL');
        const chainId = parseInt(this.configService.get('EXBT_CHAIN_ID', '11211'));
        this.provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl, { chainId, name: 'exbt-testnet' });
        const hotWalletKey = this.configService.get('EXBT_HOT_WALLET_KEY');
        this.hotWallet = new ethers_1.ethers.Wallet(hotWalletKey, this.provider);
        this.laravelWebhookUrl = `${this.configService.get('LARAVEL_URL')}/api/v1/withdrawals/webhook`;
        this.laravelApiSecret = this.configService.get('LARAVEL_API_SECRET');
    }
    async request(userId, toAddress, amount) {
        if (!ethers_1.ethers.isAddress(toAddress)) {
            throw new common_1.BadRequestException('Invalid to_address');
        }
        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            throw new common_1.BadRequestException('Invalid amount');
        }
        const withdrawal = await this.withdrawalRepo.save(this.withdrawalRepo.create({ userId, toAddress, amount, status: 'pending' }));
        this.broadcast(withdrawal.id).catch(err => console.error(`[Withdrawal] Broadcast error for ${withdrawal.id}:`, err.message));
        return withdrawal;
    }
    async getStatus(withdrawalId) {
        return this.withdrawalRepo.findOne({ where: { id: withdrawalId } });
    }
    async broadcast(withdrawalId) {
        const withdrawal = await this.withdrawalRepo.findOne({ where: { id: withdrawalId } });
        await this.withdrawalRepo.update(withdrawalId, { status: 'processing' });
        try {
            const amountWei = ethers_1.ethers.parseEther(withdrawal.amount.toString());
            const feeData = await this.provider.getFeeData();
            const gasPrice = feeData.gasPrice;
            const gasEstimate = await this.provider.estimateGas({
                to: withdrawal.toAddress,
                value: amountWei,
                from: this.hotWallet.address,
            });
            const gasLimit = gasEstimate * 120n / 100n;
            const gasCostWei = gasLimit * gasPrice;
            const hotBalance = await this.provider.getBalance(this.hotWallet.address);
            if (hotBalance < amountWei + gasCostWei) {
                throw new Error('Hot wallet has insufficient funds to process this withdrawal');
            }
            const sendWei = amountWei - gasCostWei;
            if (sendWei <= 0n)
                throw new Error('Amount too small to cover gas');
            const tx = await this.hotWallet.sendTransaction({
                to: withdrawal.toAddress,
                value: sendWei,
                gasLimit,
                gasPrice,
            });
            await tx.wait(1);
            const gasFeeEth = ethers_1.ethers.formatEther(gasCostWei);
            await this.withdrawalRepo.update(withdrawalId, {
                status: 'completed',
                txHash: tx.hash,
                gasFee: gasFeeEth,
                completedAt: new Date(),
            });
            await this.notifyLaravel({
                event: 'withdrawal.completed',
                user_id: withdrawal.userId,
                withdrawal_id: withdrawal.id,
                amount: withdrawal.amount,
                tx_hash: tx.hash,
                gas_fee: gasFeeEth,
            });
            console.log(`[Withdrawal] Completed ${withdrawal.id} — tx ${tx.hash.slice(0, 12)}...`);
        }
        catch (err) {
            console.error(`[Withdrawal] Failed ${withdrawalId}:`, err.message);
            await this.withdrawalRepo.update(withdrawalId, {
                status: 'failed',
                errorMessage: err.message,
            });
            await this.notifyLaravel({
                event: 'withdrawal.failed',
                user_id: withdrawal.userId,
                withdrawal_id: withdrawal.id,
                amount: withdrawal.amount,
                error: err.message,
            });
        }
    }
    async notifyLaravel(payload) {
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
        }
        catch (err) {
            console.error('[Withdrawal] Webhook failed:', err.message);
        }
    }
};
exports.WithdrawalService = WithdrawalService;
exports.WithdrawalService = WithdrawalService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.Withdrawal)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        config_1.ConfigService])
], WithdrawalService);
//# sourceMappingURL=withdrawal.service.js.map