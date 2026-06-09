require('dotenv').config();
const crypto = require('crypto');
const { ethers } = require('ethers');

const MASTER_PASSWORD = process.env.MASTER_PASSWORD;
if (!MASTER_PASSWORD) {
  console.error('MASTER_PASSWORD not set in .env');
  process.exit(1);
}

// Generate a random 12-word mnemonic
const mnemonic = ethers.Mnemonic.entropyToPhrase(ethers.randomBytes(16));

// Encrypt it (same AES-256-GCM as EncryptionService)
const salt    = crypto.randomBytes(32);
const key     = crypto.pbkdf2Sync(MASTER_PASSWORD, salt, 100000, 32, 'sha256');
const iv      = crypto.randomBytes(16);
const cipher  = crypto.createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(mnemonic, 'utf8'), cipher.final()]);
const authTag   = cipher.getAuthTag();

const encryptedMnemonic = {
  encrypted: encrypted.toString('hex'),
  iv:        iv.toString('hex'),
  salt:      salt.toString('hex'),
  authTag:   authTag.toString('hex'),
};

console.log('\n✅ Mnemonic (save this securely):');
console.log(mnemonic);

console.log('\n📋 Use this in Postman → POST /api/wallet/get-address:\n');
console.log(JSON.stringify({
  encrypted_mnemonic: encryptedMnemonic,
  index: 0,
  user_id: 1,
}, null, 2));
