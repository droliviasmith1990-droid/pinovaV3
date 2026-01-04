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

# 4. (Skipped) Next.js App is hosted on Vercel
echo "ℹ️  Next.js App logic skipped (Worker Only Mode)"

# 5. Start/Restart Worker (Optimized)
echo "⚙️  Checking Worker..."

# Resolve Interpreter Path (Global or Local)
INTERPRETER=$(which tsx)
if [ -z "$INTERPRETER" ]; then
    INTERPRETER="./node_modules/.bin/tsx"
fi
echo "Using interpreter: $INTERPRETER"

# Delete existing to force config update (interpreter change)
if pm2 list | grep -q "pinterest-worker"; then
    echo "Updating existing worker..."
    pm2 delete pinterest-worker
fi

echo "Starting worker..."
pm2 start src/workers/index.ts \
    --name "pinterest-worker" \
    --interpreter "$INTERPRETER" \
    --instances 3 \
    --max-memory-restart 1500M

# 6. Save PM2 list
echo "💾 Saving PM2 configuration..."
pm2 save

echo "✅ Deployment Complete!"
echo "monitor logs with: pm2 logs pinterest-worker"
