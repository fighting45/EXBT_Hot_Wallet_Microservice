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
exports.SweepTransaction = void 0;
const typeorm_1 = require("typeorm");
let SweepTransaction = class SweepTransaction {
};
exports.SweepTransaction = SweepTransaction;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], SweepTransaction.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'tx_hash', type: 'varchar', length: 66, nullable: true }),
    __metadata("design:type", String)
], SweepTransaction.prototype, "txHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'funding_tx_hash', type: 'varchar', length: 66, nullable: true }),
    __metadata("design:type", String)
], SweepTransaction.prototype, "fundingTxHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'from_address', type: 'varchar', length: 42 }),
    __metadata("design:type", String)
], SweepTransaction.prototype, "fromAddress", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'to_address', type: 'varchar', length: 42 }),
    __metadata("design:type", String)
], SweepTransaction.prototype, "toAddress", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 36, scale: 18 }),
    __metadata("design:type", String)
], SweepTransaction.prototype, "amount", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'gas_fee', type: 'decimal', precision: 36, scale: 18, nullable: true }),
    __metadata("design:type", String)
], SweepTransaction.prototype, "gasFee", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'derivation_index', type: 'integer' }),
    __metadata("design:type", Number)
], SweepTransaction.prototype, "derivationIndex", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20, default: 'pending' }),
    __metadata("design:type", String)
], SweepTransaction.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'error_message', type: 'text', nullable: true }),
    __metadata("design:type", String)
], SweepTransaction.prototype, "errorMessage", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], SweepTransaction.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], SweepTransaction.prototype, "updatedAt", void 0);
exports.SweepTransaction = SweepTransaction = __decorate([
    (0, typeorm_1.Entity)('exbt_sweep_transactions')
], SweepTransaction);
//# sourceMappingURL=sweep-transaction.entity.js.map