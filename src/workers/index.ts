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
  } catch (err: any) {
    console.error(`[Job ${job.id}] Failed:`, err);
    throw err;
  }
}, { 
  connection, 
  concurrency: 2, // Safe concurrency for 4-core VPS (allows 2 batches of parallel rendering)
  lockDuration: 300000, // 5 minutes lock
});

worker.on('completed', job => {
    console.log(`[Job ${job.id}] Completed successfully!`);
});

worker.on('failed', (job, err) => {
    console.error(`[Job ${job.id}] Failed with error: ${err.message}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing worker...');
  await worker.close();
  process.exit(0);
});
