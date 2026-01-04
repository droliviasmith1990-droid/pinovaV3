#!/bin/bash

# VPS Log Safety Setup
# Usage: ./setup_logs.sh

echo "🛡️ Setting up PM2 Log Rotation..."

# 1. Install Module
pm2 install pm2-logrotate

# 2. Configure Limits
# max_size: Rotate when file hits 10MB (Default is 10M)
pm2 set pm2-logrotate:max_size 10M

# retain: Keep last 5 files (Default is 30)
pm2 set pm2-logrotate:retain 5

# compress: Compress rotated logs to save space
pm2 set pm2-logrotate:compress true

# workerInterval: Check every hour (3600s)
pm2 set pm2-logrotate:workerInterval 3600

# rotateInterval: Handle daily rotation at midnight (cron style)
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

# 3. Apply changes by restarting (module restarts automatically on set)
echo "✅ Log Rotation Configured!"
echo "   - Max Size: 10MB"
echo "   - Retain: 5 files"
echo "   - Compression: ON"

# Show Status
pm2 conf pm2-logrotate
