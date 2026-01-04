module.exports = {
  apps: [
    {
      name: 'pinterest-app',
      script: 'npm',
      args: 'start',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
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
        NODE_ENV: 'production'
      }
    }
  ]
};
