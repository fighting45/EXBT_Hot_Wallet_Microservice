require('dotenv').config();
const app           = require('./app');
const config        = require('./config');
const depositScanner = require('./services/DepositScanner');

const server = app.listen(config.port, () => {
  console.log(`[App] EXBT wallet service listening on port ${config.port}`);
  depositScanner.start();
});

// Graceful shutdown
async function shutdown(signal) {
  console.log(`[App] ${signal} received — shutting down`);
  depositScanner.stop();
  server.close(() => {
    console.log('[App] HTTP server closed');
    process.exit(0);
  });
  // Force-kill after 10s
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
