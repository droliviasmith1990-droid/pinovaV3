import { Queue } from 'bullmq';
import Redis from 'ioredis';

// Use a separate connection for the queue vs the worker to avoid blocking
// connections in serverless/client environments
const connectionStr = process.env.REDIS_URL || 'redis://localhost:6379';

// Configure Redis connection
// BullMQ requires maxRetriesPerRequest: null
// Upstash requires 'tls' if the URL starts with rediss://
// 'family: 0' ensures dual-stack support (IPv4/IPv6)
const connection = new Redis(connectionStr, {
  maxRetriesPerRequest: null,
  family: 0, 
  tls: connectionStr.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
});

export const campaignQueue = new Queue('campaign-generation', { 
  connection 
});

export interface CampaignJobData {
  campaignId: string;
  elements?: unknown[]; // Using unknown[] to avoid circular dependency issues
  canvasSize?: { width: number; height: number };
  backgroundColor?: string;
  fieldMapping?: Record<string, string>;
  csvRows?: Record<string, string>[];
  startIndex?: number;
  batchSize?: number;
}

export const addCampaignJob = async (data: CampaignJobData) => {
  return campaignQueue.add('generate-batch', data, {
    removeOnComplete: true, // Keep memory cleanup in mind
    removeOnFail: { count: 100 }, // Keep last 100 failed jobs for debugging
  });
};

// Cleanup queue for scheduled maintenance tasks
export const cleanupQueue = new Queue('cleanup', { connection });

/**
 * Schedule the daily cleanup job (runs at midnight)
 * Call this once on worker startup
 * 
 * FIX #2: Accept optional Redis connection to reuse existing connection
 */
export const scheduleCleanupJob = async (externalConnection?: Redis) => {
  // Use the provided connection or fall back to internal one
  const queueConnection = externalConnection || connection;
  const queue = externalConnection 
    ? new Queue('cleanup', { connection: queueConnection })
    : cleanupQueue;
  
  // Remove any existing repeatable jobs first to avoid duplicates
  const existingJobs = await queue.getRepeatableJobs();
  for (const job of existingJobs) {
    await queue.removeRepeatableByKey(job.key);
  }
  
  // Schedule new daily cleanup at midnight
  await queue.add('storage-cleanup', {}, {
    repeat: { 
      pattern: '0 0 * * *' // Daily at midnight (cron format)
    },
    removeOnComplete: true,
    removeOnFail: { count: 10 },
  });
  
  console.log('[Queue] Scheduled daily cleanup job at midnight');
};

