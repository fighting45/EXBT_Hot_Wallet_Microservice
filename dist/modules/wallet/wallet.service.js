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
exports.WalletService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const config_1 = require("@nestjs/config");
const ethers_1 = require("ethers");
const entities_1 = require("../../entities");
const encryption_service_1 = require("../encryption/encryption.service");
let WalletService = class WalletService {
    constructor(walletAddressRepo, encryptionService, configService) {
        this.walletAddressRepo = walletAddressRepo;
        this.encryptionService = encryptionService;
        this.configService = configService;
        this.DERIVATION_PATH = "m/44'/60'/0'/0";
    }
    generateMnemonic(wordCount = 12) {
        const entropy = wordCount === 12 ? ethers_1.ethers.randomBytes(16) : ethers_1.ethers.randomBytes(32);
        return ethers_1.ethers.Mnemonic.entropyToPhrase(entropy);
    }
    validateMnemonic(mnemonic) {
        try {
            ethers_1.ethers.Mnemonic.fromPhrase(mnemonic);
            return true;
        }
        catch {
            return false;
        }
    }
    deriveWallet(mnemonic, index) {
        const path = `${this.DERIVATION_PATH}/${index}`;
        const hdWallet = ethers_1.ethers.HDNodeWallet.fromMnemonic(ethers_1.ethers.Mnemonic.fromPhrase(mnemonic), path);
        return {
            address: hdWallet.address,
            privateKey: hdWallet.privateKey,
            derivationPath: path,
            index,
        };
    }
    isValidAddress(address) {
        return ethers_1.ethers.isAddress(address);
    }
    async getOrCreateAddress(encryptedMnemonic, userId, index) {
        const existing = await this.walletAddressRepo.findOne({ where: { userId } });
        if (existing)
            return { walletAddress: existing, isNew: false };
        const indexInUse = await this.walletAddressRepo.findOne({ where: { derivationIndex: index } });
        if (indexInUse) {
            throw new common_1.ConflictException(`Derivation index ${index} is already assigned to another user`);
        }
        const masterPassword = this.configService.get('MASTER_PASSWORD');
        const mnemonic = this.encryptionService.decrypt(encryptedMnemonic, masterPassword);
        const { address } = this.deriveWallet(mnemonic, index);
        const walletAddress = await this.walletAddressRepo.save(this.walletAddressRepo.create({ userId, address, derivationIndex: index }));
        return { walletAddress, isNew: true };
    }
    async getAllAddresses() {
        return this.walletAddressRepo.find();
    }
    async getAddressByUserId(userId) {
        return this.walletAddressRepo.findOne({ where: { userId } });
    }
};
exports.WalletService = WalletService;
exports.WalletService = WalletService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.WalletAddress)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        encryption_service_1.EncryptionService,
        config_1.ConfigService])
], WalletService);
//# sourceMappingURL=wallet.service.js.map