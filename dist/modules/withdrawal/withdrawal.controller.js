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
exports.WithdrawalController = void 0;
const common_1 = require("@nestjs/common");
const withdrawal_service_1 = require("./withdrawal.service");
const withdrawal_dto_1 = require("./dto/withdrawal.dto");
let WithdrawalController = class WithdrawalController {
    constructor(withdrawalService) {
        this.withdrawalService = withdrawalService;
    }
    async request(dto) {
        const withdrawal = await this.withdrawalService.request(dto.user_id, dto.to_address, dto.amount);
        return { withdrawal_id: withdrawal.id, status: withdrawal.status };
    }
    async status(id) {
        const withdrawal = await this.withdrawalService.getStatus(id);
        if (!withdrawal)
            throw new common_1.NotFoundException('Withdrawal not found');
        return withdrawal;
    }
};
exports.WithdrawalController = WithdrawalController;
__decorate([
    (0, common_1.Post)('request'),
    (0, common_1.HttpCode)(202),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [withdrawal_dto_1.WithdrawalRequestDto]),
    __metadata("design:returntype", Promise)
], WithdrawalController.prototype, "request", null);
__decorate([
    (0, common_1.Get)(':id/status'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], WithdrawalController.prototype, "status", null);
exports.WithdrawalController = WithdrawalController = __decorate([
    (0, common_1.Controller)('api/withdrawal'),
    __metadata("design:paramtypes", [withdrawal_service_1.WithdrawalService])
], WithdrawalController);
//# sourceMappingURL=withdrawal.controller.js.map