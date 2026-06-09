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
exports.SweeperController = void 0;
const common_1 = require("@nestjs/common");
const sweeper_service_1 = require("./sweeper.service");
const sweeper_dto_1 = require("./dto/sweeper.dto");
let SweeperController = class SweeperController {
    constructor(sweeperService) {
        this.sweeperService = sweeperService;
    }
    estimate(dto) {
        return this.sweeperService.estimateSweep(dto.encrypted_mnemonic, dto.start_index, dto.end_index, dto.min_balance);
    }
    execute(dto) {
        return this.sweeperService.executeSweep(dto.encrypted_mnemonic, dto.addresses);
    }
    status(txHash) {
        return this.sweeperService.getSweepStatus(txHash);
    }
};
exports.SweeperController = SweeperController;
__decorate([
    (0, common_1.Post)('estimate'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [sweeper_dto_1.EstimateSweepDto]),
    __metadata("design:returntype", void 0)
], SweeperController.prototype, "estimate", null);
__decorate([
    (0, common_1.Post)('execute'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [sweeper_dto_1.ExecuteSweepDto]),
    __metadata("design:returntype", void 0)
], SweeperController.prototype, "execute", null);
__decorate([
    (0, common_1.Get)('status/:txHash'),
    __param(0, (0, common_1.Param)('txHash')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SweeperController.prototype, "status", null);
exports.SweeperController = SweeperController = __decorate([
    (0, common_1.Controller)('api/sweeper'),
    __metadata("design:paramtypes", [sweeper_service_1.SweeperService])
], SweeperController);
//# sourceMappingURL=sweeper.controller.js.map