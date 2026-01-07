module.exports = {
  apps: [
    {
      name: 'pinterest-app',
      script: 'npm',
      args: 'start -- -H 0.0.0.0',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        REDIS_URL: 'redis://127.0.0.1:6379'
      }
    },
    {
      name: 'pinterest-worker',
      script: 'node_modules/.bin/tsx',
      args: 'src/workers/index.ts',
      instances: 4,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      // Fix PM2 logging with tsx - force unbuffered output
      merge_logs: false,
      out_file: '/root/.pm2/logs/pinterest-worker-out.log',
      error_file: '/root/.pm2/logs/pinterest-worker-error.log',
      env: {
        NODE_ENV: 'production',
        REDIS_URL: 'redis://127.0.0.1:6379',
        // Reduce logging noise
        CANVAS_POOL_DEBUG: 'false'
      }
    }
  ]
};
