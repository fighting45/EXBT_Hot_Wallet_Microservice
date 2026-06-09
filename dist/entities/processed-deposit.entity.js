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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessedDeposit = void 0;
const typeorm_1 = require("typeorm");
let ProcessedDeposit = class ProcessedDeposit {
};
exports.ProcessedDeposit = ProcessedDeposit;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], ProcessedDeposit.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'tx_hash', type: 'varchar', length: 66 }),
    __metadata("design:type", String)
], ProcessedDeposit.prototype, "txHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'user_id', type: 'bigint' }),
    __metadata("design:type", Number)
], ProcessedDeposit.prototype, "userId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 42 }),
    __metadata("design:type", String)
], ProcessedDeposit.prototype, "address", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 36, scale: 18 }),
    __metadata("design:type", String)
], ProcessedDeposit.prototype, "amount", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'block_number', type: 'bigint' }),
    __metadata("design:type", Number)
], ProcessedDeposit.prototype, "blockNumber", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'processed_at' }),
    __metadata("design:type", Date)
], ProcessedDeposit.prototype, "processedAt", void 0);
exports.ProcessedDeposit = ProcessedDeposit = __decorate([
    (0, typeorm_1.Entity)('exbt_processed_deposits'),
    (0, typeorm_1.Unique)(['txHash'])
], ProcessedDeposit);
//# sourceMappingURL=processed-deposit.entity.js.map