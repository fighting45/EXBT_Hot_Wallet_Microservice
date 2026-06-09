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
exports.WalletController = void 0;
const common_1 = require("@nestjs/common");
const wallet_service_1 = require("./wallet.service");
const listener_service_1 = require("../listener/listener.service");
const wallet_dto_1 = require("./dto/wallet.dto");
let WalletController = class WalletController {
    constructor(walletService, listenerService) {
        this.walletService = walletService;
        this.listenerService = listenerService;
    }
    health() {
        return { status: 'ok', ts: new Date().toISOString(), service: 'exbt-wallet-service' };
    }
    async getAddress(dto) {
        const { walletAddress, isNew } = await this.walletService.getOrCreateAddress(dto.encrypted_mnemonic, dto.user_id, dto.index);
        if (isNew) {
            this.listenerService.registerAddress(dto.user_id, walletAddress.address);
        }
        return {
            success: true,
            address: walletAddress.address,
            index: walletAddress.derivationIndex,
            derivation_path: `m/44'/60'/0'/0/${walletAddress.derivationIndex}`,
            user_id: dto.user_id,
            is_new: isNew,
            monitoring: true,
        };
    }
    validateAddress(dto) {
        return {
            address: dto.address,
            valid: this.walletService.isValidAddress(dto.address),
        };
    }
    validateMnemonic(dto) {
        return {
            valid: this.walletService.validateMnemonic(dto.mnemonic),
        };
    }
    generateMnemonic() {
        return {
            mnemonic: this.walletService.generateMnemonic(),
            words: 12,
        };
    }
};
exports.WalletController = WalletController;
__decorate([
    (0, common_1.Get)('health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "health", null);
__decorate([
    (0, common_1.Post)('get-address'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [wallet_dto_1.GetAddressDto]),
    __metadata("design:returntype", Promise)
], WalletController.prototype, "getAddress", null);
__decorate([
    (0, common_1.Post)('validate-address'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [wallet_dto_1.ValidateAddressDto]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "validateAddress", null);
__decorate([
    (0, common_1.Post)('validate-mnemonic'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [wallet_dto_1.ValidateMnemonicDto]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "validateMnemonic", null);
__decorate([
    (0, common_1.Post)('generate-mnemonic'),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "generateMnemonic", null);
exports.WalletController = WalletController = __decorate([
    (0, common_1.Controller)('api/wallet'),
    __metadata("design:paramtypes", [wallet_service_1.WalletService,
        listener_service_1.ListenerService])
], WalletController);
//# sourceMappingURL=wallet.controller.js.map