import { Worker } from 'bullmq';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import { processCampaignBatch } from './processors/campaignProcessor';

// Load environment variables
dotenv.config();

const connectionStr = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new Redis(connectionStr, {
  maxRetriesPerRequest: null
});

console.log('🚀 Worker started. Listening for jobs...');
console.log(`🔌 Redis: ${connectionStr.replace(/:[^@]+@/, ':***@')}`); // Shield password in logs

const worker = new Worker('campaign-generation', async (job) => {
  console.log(`[Job ${job.id}] Started - Campaign: ${job.data.campaignId}, Index: ${job.data.startIndex}`);
  
  try {
    const result = await processCampaignBatch(job.data);
    return result;
  } catch (err) {
    const error = err as Error;
    console.error(`[Job ${job.id}] Failed:`, error);
    throw error;
  }
}, { 
  connection, 
  concurrency: 1, // 1 batch per process (3 processes total = 3 concurrent batches)
  lockDuration: 300000, // 5 minutes lock
  // OPTIMIZATION: Reduce Redis chatter
  // Check for stalled jobs every 2 minutes instead of 30 seconds
  stalledInterval: 120000, 
  // Max retries per job is handled in queue.add, but fail immediately if processing fails to avoid zombie loops
});

worker.on('completed', job => {
    console.log(`[Job ${job.id}] Completed successfully!`);
});

worker.on('failed', (job, err) => {
    console.error(`[Job ${job?.id}] Failed with error: ${err.message}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing worker...');
  await worker.close();
  process.exit(0);
});
