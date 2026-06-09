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
var SweeperService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SweeperService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const config_1 = require("@nestjs/config");
const ethers_1 = require("ethers");
const entities_1 = require("../../entities");
const wallet_service_1 = require("../wallet/wallet.service");
const encryption_service_1 = require("../encryption/encryption.service");
let SweeperService = SweeperService_1 = class SweeperService {
    constructor(sweepTxRepo, walletService, encryptionService, configService) {
        this.sweepTxRepo = sweepTxRepo;
        this.walletService = walletService;
        this.encryptionService = encryptionService;
        this.configService = configService;
        this.logger = new common_1.Logger(SweeperService_1.name);
        const rpcUrl = this.configService.get('EXBT_RPC_URL');
        const chainId = parseInt(this.configService.get('EXBT_CHAIN_ID', '11211'));
        this.provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl, { chainId, name: 'exbt-testnet' });
        const hotWalletKey = this.configService.get('EXBT_HOT_WALLET_KEY');
        this.hotWallet = new ethers_1.ethers.Wallet(hotWalletKey, this.provider);
        this.hotWalletAddress = this.hotWallet.address;
    }
    async onModuleInit() {
        if (!this.configService.get('EXBT_HOT_WALLET_KEY')) {
            this.logger.warn('EXBT_HOT_WALLET_KEY not set — sweeper will not work');
            return;
        }
        this.logger.log(`Sweeper initialized — hot wallet: ${this.hotWalletAddress}`);
    }
    async estimateSweep(encryptedMnemonic, startIndex, endIndex, minBalance = '0.001') {
        const masterPassword = this.configService.get('MASTER_PASSWORD');
        const mnemonic = this.encryptionService.decrypt(encryptedMnemonic, masterPassword);
        const minWei = ethers_1.ethers.parseEther(minBalance);
        this.logger.log(`Scanning addresses ${startIndex}–${endIndex} for balance >= ${minBalance} EXBT`);
        const addressesWithBalance = [];
        for (let i = startIndex; i < endIndex; i++) {
            try {
                const { address } = this.walletService.deriveWallet(mnemonic, i);
                const balance = await this.provider.getBalance(address);
                if (balance > minWei) {
                    addressesWithBalance.push({ address, index: i, balance: ethers_1.ethers.formatEther(balance) });
                }
            }
            catch (err) {
                this.logger.error(`Error checking index ${i}: ${err.message}`);
            }
        }
        const hotBalance = await this.provider.getBalance(this.hotWalletAddress);
        const feeData = await this.provider.getFeeData();
        const gasPerTx = 21000n;
        const gasCostEach = (gasPerTx * 120n / 100n) * feeData.gasPrice * 2n;
        const totalGasNeeded = gasCostEach * BigInt(addressesWithBalance.length);
        this.logger.log(`Found ${addressesWithBalance.length} addresses to sweep`);
        return {
            addresses_to_sweep: addressesWithBalance,
            total_exbt: addressesWithBalance.reduce((s, a) => s + parseFloat(a.balance), 0).toFixed(18),
            hot_wallet_balance: ethers_1.ethers.formatEther(hotBalance),
            estimated_gas_total: ethers_1.ethers.formatEther(totalGasNeeded),
            sufficient_balance: hotBalance > totalGasNeeded,
        };
    }
    async executeSweep(encryptedMnemonic, addresses) {
        const masterPassword = this.configService.get('MASTER_PASSWORD');
        const mnemonic = this.encryptionService.decrypt(encryptedMnemonic, masterPassword);
        const results = [];
        for (const { address, index, balance } of addresses) {
            const result = await this.sweepAddress(mnemonic, address, index, balance);
            results.push(result);
            await this.sleep(2000);
        }
        return results;
    }
    async sweepAddress(mnemonic, address, index, balance) {
        this.logger.log(`Sweeping ${balance} EXBT from ${address} (index ${index})`);
        try {
            const feeData = await this.provider.getFeeData();
            const gasPrice = feeData.gasPrice;
            const gasEstimate = await this.provider.estimateGas({ to: this.hotWalletAddress, from: address });
            const gasLimit = gasEstimate * 120n / 100n;
            const gasCostWei = gasLimit * gasPrice;
            this.logger.log(`Funding ${address} with ${ethers_1.ethers.formatEther(gasCostWei)} EXBT for gas`);
            const fundTx = await this.hotWallet.sendTransaction({ to: address, value: gasCostWei });
            await fundTx.wait(1);
            const currentBalance = await this.provider.getBalance(address);
            const sendAmount = currentBalance - gasCostWei;
            if (sendAmount <= 0n)
                throw new Error('Balance too low after gas funding');
            const { privateKey } = this.walletService.deriveWallet(mnemonic, index);
            const userWallet = new ethers_1.ethers.Wallet(privateKey, this.provider);
            const sweepTx = await userWallet.sendTransaction({
                to: this.hotWalletAddress,
                value: sendAmount,
                gasLimit,
                gasPrice,
            });
            await sweepTx.wait(1);
            await this.sweepTxRepo.save(this.sweepTxRepo.create({
                txHash: sweepTx.hash,
                fundingTxHash: fundTx.hash,
                fromAddress: address,
                toAddress: this.hotWalletAddress,
                amount: ethers_1.ethers.formatEther(sendAmount),
                gasFee: ethers_1.ethers.formatEther(gasCostWei),
                derivationIndex: index,
                status: 'completed',
            }));
            this.logger.log(`Sweep complete for ${address}: ${sweepTx.hash}`);
            return { address, index, txHash: sweepTx.hash, fundingTxHash: fundTx.hash, status: 'completed' };
        }
        catch (err) {
            this.logger.error(`Sweep failed for ${address}: ${err.message}`);
            await this.sweepTxRepo.save(this.sweepTxRepo.create({
                fromAddress: address,
                toAddress: this.hotWalletAddress,
                amount: balance,
                derivationIndex: index,
                status: 'failed',
                errorMessage: err.message,
            }));
            return { address, index, txHash: '', fundingTxHash: '', status: 'failed', error: err.message };
        }
    }
    async getSweepStatus(txHash) {
        return this.sweepTxRepo.findOne({ where: { txHash } });
    }
    sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
};
exports.SweeperService = SweeperService;
exports.SweeperService = SweeperService = SweeperService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.SweepTransaction)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        wallet_service_1.WalletService,
        encryption_service_1.EncryptionService,
        config_1.ConfigService])
], SweeperService);
//# sourceMappingURL=sweeper.service.js.map