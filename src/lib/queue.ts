import { Queue } from 'bullmq';
import Redis from 'ioredis';

// Use a separate connection for the queue vs the worker to avoid blocking
// connections in serverless/client environments
const connectionStr = process.env.REDIS_URL || 'redis://localhost:6379';

// Configure Redis connection
const connection = new Redis(connectionStr, {
  maxRetriesPerRequest: null, // Required by BullMQ
});

export const campaignQueue = new Queue('campaign-generation', { 
  connection 
});

export interface CampaignJobData {
  campaignId: string;
  elements?: any[]; // Using any[] to avoid circular dependency issues, but effectively Element[]
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
