import { Worker } from 'bullmq';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import { processCampaignBatch } from './processors/campaignProcessor';
import { processCleanup } from './processors/cleanupProcessor';
import { scheduleCleanupJob } from '../lib/queue';

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
  console.log(`[Campaign ${job.id}] Started - Campaign: ${job.data.campaignId}, Index: ${job.data.startIndex}`);
  
  try {
    const result = await processCampaignBatch(job.data);
    return result;
  } catch (err) {
    const error = err as Error;
    console.error(`[Campaign ${job.id}] Failed:`, error);
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

// Schedule cleanup job on startup
scheduleCleanupJob().catch(err => {
  console.error('[Worker] Failed to schedule cleanup job:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing workers...');
  await Promise.all([
    campaignWorker.close(),
    cleanupWorker.close()
  ]);
  process.exit(0);
});

