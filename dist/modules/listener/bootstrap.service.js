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
exports.BootstrapService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const config_1 = require("@nestjs/config");
const entities_1 = require("../../entities");
const listener_service_1 = require("./listener.service");
let BootstrapService = class BootstrapService {
    constructor(walletAddressRepo, listenerService, configService) {
        this.walletAddressRepo = walletAddressRepo;
        this.listenerService = listenerService;
        this.configService = configService;
    }
    async onModuleInit() {
        const autoStart = this.configService.get('AUTO_START_LISTENERS', 'true') === 'true';
        if (!autoStart) {
            console.log('[Bootstrap] AUTO_START_LISTENERS=false — listener not started');
            return;
        }
        try {
            const addresses = await this.walletAddressRepo.find();
            const list = addresses.map(a => ({ user_id: Number(a.userId), address: a.address }));
            console.log(`[Bootstrap] Loaded ${list.length} addresses from DB`);
            this.listenerService.startListener(list).catch(err => {
                console.error('[Bootstrap] Listener crashed:', err.message);
            });
        }
        catch (err) {
            console.error('[Bootstrap] Failed to load addresses:', err.message);
        }
    }
};
exports.BootstrapService = BootstrapService;
exports.BootstrapService = BootstrapService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(entities_1.WalletAddress)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        listener_service_1.ListenerService,
        config_1.ConfigService])
], BootstrapService);
//# sourceMappingURL=bootstrap.service.js.map