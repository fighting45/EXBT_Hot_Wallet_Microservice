module.exports = {
  apps: [
    {
      name:         'exbt-wallet-service',
      script:       'src/index.js',
      instances:    1,
      autorestart:  true,
      watch:        false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
