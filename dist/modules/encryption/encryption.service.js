"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EncryptionService = void 0;
const common_1 = require("@nestjs/common");
const crypto = require("crypto");
let EncryptionService = class EncryptionService {
    constructor() {
        this.ALGORITHM = 'aes-256-gcm';
        this.KEY_LENGTH = 32;
        this.IV_LENGTH = 16;
        this.SALT_LENGTH = 32;
        this.TAG_LENGTH = 16;
    }
    encrypt(plaintext, password) {
        const salt = crypto.randomBytes(this.SALT_LENGTH);
        const key = crypto.pbkdf2Sync(password, salt, 100000, this.KEY_LENGTH, 'sha256');
        const iv = crypto.randomBytes(this.IV_LENGTH);
        const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);
        const encrypted = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();
        return {
            encrypted: encrypted.toString('hex'),
            iv: iv.toString('hex'),
            salt: salt.toString('hex'),
            authTag: authTag.toString('hex'),
        };
    }
    decrypt(encryptedData, password) {
        const salt = Buffer.from(encryptedData.salt, 'hex');
        const iv = Buffer.from(encryptedData.iv, 'hex');
        const authTag = Buffer.from(encryptedData.authTag, 'hex');
        const encrypted = Buffer.from(encryptedData.encrypted, 'hex');
        const key = crypto.pbkdf2Sync(password, salt, 100000, this.KEY_LENGTH, 'sha256');
        const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final(),
        ]);
        return decrypted.toString('utf8');
    }
    generatePassword(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }
};
exports.EncryptionService = EncryptionService;
exports.EncryptionService = EncryptionService = __decorate([
    (0, common_1.Injectable)()
], EncryptionService);
//# sourceMappingURL=encryption.service.js.map