"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SweeperModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const entities_1 = require("../../entities");
const sweeper_service_1 = require("./sweeper.service");
const sweeper_controller_1 = require("./sweeper.controller");
const wallet_module_1 = require("../wallet/wallet.module");
const encryption_module_1 = require("../encryption/encryption.module");
let SweeperModule = class SweeperModule {
};
exports.SweeperModule = SweeperModule;
exports.SweeperModule = SweeperModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([entities_1.SweepTransaction]), wallet_module_1.WalletModule, encryption_module_1.EncryptionModule],
        providers: [sweeper_service_1.SweeperService],
        controllers: [sweeper_controller_1.SweeperController],
    })
], SweeperModule);
//# sourceMappingURL=sweeper.module.js.map