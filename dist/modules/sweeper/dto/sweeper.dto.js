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
exports.ExecuteSweepDto = exports.AddressToSweepDto = exports.EstimateSweepDto = exports.EncryptedMnemonicDto = void 0;
const class_validator_1 = require("class-validator");
class EncryptedMnemonicDto {
}
exports.EncryptedMnemonicDto = EncryptedMnemonicDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EncryptedMnemonicDto.prototype, "encrypted", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EncryptedMnemonicDto.prototype, "iv", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EncryptedMnemonicDto.prototype, "salt", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EncryptedMnemonicDto.prototype, "authTag", void 0);
class EstimateSweepDto {
}
exports.EstimateSweepDto = EstimateSweepDto;
__decorate([
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", EncryptedMnemonicDto)
], EstimateSweepDto.prototype, "encrypted_mnemonic", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], EstimateSweepDto.prototype, "start_index", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], EstimateSweepDto.prototype, "end_index", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EstimateSweepDto.prototype, "min_balance", void 0);
class AddressToSweepDto {
}
exports.AddressToSweepDto = AddressToSweepDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AddressToSweepDto.prototype, "address", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], AddressToSweepDto.prototype, "index", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AddressToSweepDto.prototype, "balance", void 0);
class ExecuteSweepDto {
}
exports.ExecuteSweepDto = ExecuteSweepDto;
__decorate([
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", EncryptedMnemonicDto)
], ExecuteSweepDto.prototype, "encrypted_mnemonic", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    __metadata("design:type", Array)
], ExecuteSweepDto.prototype, "addresses", void 0);
//# sourceMappingURL=sweeper.dto.js.map