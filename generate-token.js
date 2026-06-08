require("dotenv").config();
const crypto = require("crypto");

// Pass request body as first argument, e.g:
// node generate-token.js '{"user_id":123}'
// For GET requests with no body, run with no argument

const body = process.argv[2] || "";
const timestamp = Math.floor(Date.now() / 1000).toString();
const secret = process.env.SERVICE_TOKEN_SECRET;

const token = crypto
  .createHmac("sha256", secret)
  .update(`${timestamp}:${body}`)
  .digest("hex");

console.log("\nAdd these headers to your Postman request:\n");
console.log(`X-Timestamp:     ${timestamp}`);
console.log(`X-Service-Token: ${token}`);
console.log("\nNote: token expires in 60 seconds\n");
