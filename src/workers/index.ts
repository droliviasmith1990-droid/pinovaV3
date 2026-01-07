// Log immediately to diagnose startup delays
console.log(`[Worker] Starting (PID: ${process.pid}) at ${new Date().toISOString()}`);

import { Worker } from 'bullmq';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';

console.log('[Worker] Core imports loaded');

// Defer heavy processor imports until after core setup
import { processCampaignBatch } from './processors/campaignProcessor';
import { processCleanup } from './processors/cleanupProcessor';
import { scheduleCleanupJob } from '../lib/queue';

console.log('[Worker] All imports loaded');

// Load environment variables
dotenv.config();

const connectionStr = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new Redis(connectionStr, {
  maxRetriesPerRequest: null
});

console.log('🚀 Worker started. Listening for jobs...');
console.log(`🔌 Redis: ${connectionStr.replace(/:[^@]+@/, ':***@')}`);

// Campaign generation worker
const campaignWorker = new Worker('campaign-generation', async (job) => {
  const startTime = Date.now();
  console.log(`[Campaign ${job.id}] Started - Campaign: ${job.data.campaignId}, Index: ${job.data.startIndex}`);
  
  try {
    const result = await processCampaignBatch(job.data);
    console.log(`[Campaign ${job.id}] Completed in ${Date.now() - startTime}ms`);
    return result;
  } catch (err) {
    const error = err as Error;
    console.error(`[Campaign ${job.id}] Failed after ${Date.now() - startTime}ms:`, error);
    throw error;
  }
}, { 
  connection, 
  concurrency: 1,
  lockDuration: 300000,
  stalledInterval: 120000, 
});

campaignWorker.on('completed', job => {
    console.log(`[Campaign ${job.id}] Completed successfully!`);
});

campaignWorker.on('failed', (job, err) => {
    console.error(`[Campaign ${job?.id}] Failed with error: ${err.message}`);
});

// Cleanup worker (for scheduled maintenance)
const cleanupWorker = new Worker('cleanup', async (job) => {
  console.log(`[Cleanup ${job.id}] Starting storage cleanup...`);
  
  try {
    const result = await processCleanup();
    console.log(`[Cleanup ${job.id}] Completed: ${result.cleaned} files cleaned`);
    return result;
  } catch (err) {
    const error = err as Error;
    console.error(`[Cleanup ${job.id}] Failed:`, error);
    throw error;
  }
}, { 
  connection,
  concurrency: 1,
});

cleanupWorker.on('completed', job => {
    console.log(`[Cleanup ${job.id}] Completed successfully!`);
});

cleanupWorker.on('failed', (job, err) => {
    console.error(`[Cleanup ${job?.id}] Failed with error: ${err.message}`);
});

// FIX #1: Use Redis lock to prevent multiple workers from scheduling cleanup jobs
const CLEANUP_SCHEDULER_LOCK = 'lock:cleanup-scheduler';
const LOCK_TTL = 60; // 60 seconds - enough time to schedule

async function tryScheduleCleanupJob() {
  try {
    // Try to acquire lock (only one worker will succeed)
    const acquired = await connection.set(CLEANUP_SCHEDULER_LOCK, process.pid.toString(), 'EX', LOCK_TTL, 'NX');
    
    if (acquired === 'OK') {
      console.log('[Worker] Acquired scheduler lock, scheduling cleanup job...');
      // FIX #2: Pass our existing connection to avoid creating duplicate Redis connections
      await scheduleCleanupJob(connection);
    } else {
      console.log('[Worker] Another worker is scheduling cleanup job, skipping...');
    }
  } catch (err) {
    console.error('[Worker] Failed to schedule cleanup job:', err);
  }
}

// Schedule cleanup job with lock
tryScheduleCleanupJob();

// Graceful shutdown handler with timeout
const SHUTDOWN_TIMEOUT = 10000; // 10 seconds

async function gracefulShutdown(signal: string) {
  console.log(`${signal} received, closing workers...`);
  
  // Issue #6 Fix: Add timeout to prevent hanging on worker.close()
  const shutdownPromise = Promise.all([
    campaignWorker.close(),
    cleanupWorker.close()
  ]);
  
  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT);
  });
  
  try {
    await Promise.race([shutdownPromise, timeoutPromise]);
    console.log('Workers closed gracefully');
  } catch {
    console.warn('Shutdown timeout reached, forcing exit');
  }
  
  await connection.quit().catch(() => { /* ignore errors on quit */ });
  process.exit(0);
}

// FIX #3: Handle both SIGTERM and SIGINT (Ctrl+C)
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
