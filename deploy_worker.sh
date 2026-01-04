#!/bin/bash

# ==========================================
# Pinterest Worker Deployment Script (PM2)
# ==========================================

echo "🚀 Starting Deployment..."

# 1. Redis Health Check
echo "Testing Redis connection..."
if ! redis-cli ping > /dev/null 2>&1; then
    echo "❌ Error: Redis is not running or not accessible!"
    echo "Please start Redis first (systemctl start redis-server)"
    exit 1
fi
echo "✅ Redis is UP"

# 2. Install Global Tools (PM2, TSX)
echo "📦 Installing global dependencies..."
npm install -g pm2 typescript tsx

# 3. Install Project Dependencies
echo "📚 Installing project dependencies..."
npm install --production --no-audit

# 4. Start/Restart Next.js App
echo "🌐 Checking Next.js App..."
if pm2 list | grep -q "pinterest-app"; then
    echo "Restarting app..."
    pm2 restart pinterest-app
else
    echo "Starting app..."
    pm2 start npm --name "pinterest-app" -- start
fi

# 5. Start/Restart Worker (Optimized)
echo "⚙️  Checking Worker..."
# Improvements:
# - Instances 1: BullMQ handles concurrency internally
# - Memory 1500M: Restart if leaks occur (safety for 8GB VPS)
if pm2 list | grep -q "pinterest-worker"; then
    echo "Restarting worker..."
    pm2 restart pinterest-worker
else
    echo "Starting new worker..."
    pm2 start src/workers/index.ts \
        --name "pinterest-worker" \
        --interpreter ./node_modules/.bin/tsx \
        --instances 1 \
        --max-memory-restart 1500M
fi

# 6. Save PM2 list
echo "💾 Saving PM2 configuration..."
pm2 save

echo "✅ Deployment Complete!"
echo "monitor logs with: pm2 logs pinterest-worker"
