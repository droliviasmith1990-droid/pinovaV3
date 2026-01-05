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
      script: 'node_modules/.bin/tsx', // Use local tsx
      args: 'src/workers/index.ts',
      instances: 1, // Keep to 1 to save Redis connections
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        REDIS_URL: 'redis://127.0.0.1:6379'
      }
    }
  ]
};
