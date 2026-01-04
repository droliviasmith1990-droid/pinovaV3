import 'server-only';
import Redis from 'ioredis';

/**
 * Redis Client (ioredis)
 * 
 * Defaults to local Redis (127.0.0.1:6379) which is free and unlimited on VPS.
 * Can be overridden with REDIS_URL environment variable.
 */

// Singleton pattern - create once, reuse everywhere
let redis: Redis | null = null;

export function getRedis(): Redis | null {
    if (redis) return redis;

    try {
        const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
        
        console.log(`[Redis] Connecting to ${redisUrl.includes('localhost') || redisUrl.includes('127.0.0.1') ? 'Localhost' : 'Remote'}...`);

        redis = new Redis(redisUrl, {
            maxRetriesPerRequest: null, // Required for BullMQ compatibility if we share connection (though avoiding sharing is safer)
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            // Don't crash if connection fails initially, just keep retrying
            lazyConnect: true
        });

        // Handle errors gracefully without crashing app
        redis.on('error', (err) => {
           // Suppress mostly, just log
           // console.error('[Redis] Connection Error:', err.message);
        });

        return redis;
    } catch (error) {
        console.error('[Redis] Init Error:', error);
        return null;
    }
}

// =============================================================================
// CACHE UTILITIES
// =============================================================================

/**
 * Cache wrapper with TTL (Time To Live)
 */
export async function cacheGet<T>(
    key: string,
    fallback: () => Promise<T>,
    ttlSeconds: number = 300 // Default 5 minutes
): Promise<T> {
    const redis = getRedis();
    
    // No Redis? Just call fallback directly
    if (!redis) {
        return fallback();
    }
    
    try {
        // Try cache first
        const cached = await redis.get(key);
        if (cached) {
            try {
                // Try parsing JSON, if it fails return string
                return JSON.parse(cached) as T;
            } catch {
                return cached as unknown as T;
            }
        }
        
        // Cache miss - get fresh data
        console.log(`[Cache] MISS: ${key}`);
        const fresh = await fallback();
        
        // Store in cache with TTL
        // ioredis set(key, value, 'EX', ttl)
        if (fresh !== undefined && fresh !== null) {
            const serialized = typeof fresh === 'object' ? JSON.stringify(fresh) : String(fresh);
            await redis.set(key, serialized, 'EX', ttlSeconds);
        }
        
        return fresh;
    } catch (error) {
        console.error(`[Cache] Error for ${key}:`, error);
        return fallback();
    }
}

/**
 * Invalidate a cache key
 */
export async function cacheInvalidate(key: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    
    try {
        await redis.del(key);
        console.log(`[Cache] Invalidated: ${key}`);
    } catch (error) {
        console.error(`[Cache] Failed to invalidate ${key}:`, error);
    }
}

/**
 * Invalidate multiple keys matching a pattern
 */
export async function cacheInvalidatePattern(pattern: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    
    try {
        // Use SCAN instead of KEYS for performance in production
        const stream = redis.scanStream({
            match: pattern,
            count: 100
        });

        stream.on('data', async (keys) => {
            if (keys.length) {
                await redis!.del(...keys);
            }
        });
        
    } catch (error) {
        console.error(`[Cache] Failed to invalidate pattern ${pattern}:`, error);
    }
}

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * Simple rate limiter using sliding window
 */
export async function checkRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number
): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return true; 
    
    try {
        const now = Date.now();
        const windowKey = `ratelimit:${key}`;
        
        // Transaction (Pipeline)
        const pipeline = redis.pipeline();
        
        // Remove old entries
        pipeline.zremrangebyscore(windowKey, 0, now - (windowSeconds * 1000));
        // Count current
        pipeline.zcard(windowKey);
        // Add current (score, member)
        pipeline.zadd(windowKey, now, `${now}`);
        // Set expiry
        pipeline.expire(windowKey, windowSeconds);
        
        const results = await pipeline.exec();
        // results[1][1] is zcard result
        const count = results ? (results[1]?.[1] as number) : 0;
        
        if (count > maxRequests) {
             console.log(`[RateLimit] Exceeded: ${key} (${count}/${maxRequests})`);
             return false;
        }
        
        return true;
    } catch (error) {
        console.error(`[RateLimit] Redis error, allowing request:`, error);
        return true; 
    }
}

// =============================================================================
// CAMPAIGN PROGRESS TRACKING
// =============================================================================

export interface CampaignProgress {
    campaignId: string;
    total: number;
    completed: number;
    failed: number;
    status: 'pending' | 'queueing' | 'processing' | 'completed' | 'failed';
    startedAt?: string;
    completedAt?: string;
    errors?: string[];
}

export async function setProgress(
    campaignId: string,
    progress: Partial<CampaignProgress>
): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    
    try {
        const key = `progress:${campaignId}`;
        
        // Prepare hash data compatible with ioredis (string keys/values)
        const hashData: Record<string, string | number> = {
            campaignId,
        };
        
        if (progress.total !== undefined) hashData.total = progress.total;
        if (progress.completed !== undefined) hashData.completed = progress.completed;
        if (progress.failed !== undefined) hashData.failed = progress.failed;
        if (progress.status !== undefined) hashData.status = progress.status;
        if (progress.errors !== undefined) hashData.errors = JSON.stringify(progress.errors);
         
        // Auto-set timestamps
        if (progress.status === 'processing') {
            hashData.startedAt = new Date().toISOString();
        }
        if (progress.status === 'completed' || progress.status === 'failed') {
            hashData.completedAt = new Date().toISOString();
        }
        
        await redis.hset(key, hashData);
        await redis.expire(key, 86400); // 24h TTL
    } catch (error) {
        console.error(`[Progress] Failed to set progress for ${campaignId}:`, error);
    }
}

export async function getProgress(campaignId: string): Promise<CampaignProgress | null> {
    const redis = getRedis();
    if (!redis) return null;
    
    try {
        const key = `progress:${campaignId}`;
        const data = await redis.hgetall(key);
        
        if (!data || Object.keys(data).length === 0) {
            return null;
        }
        
        // ioredis returns strings, need to parse
        return {
            campaignId: data.campaignId || campaignId,
            total: Number(data.total) || 0,
            completed: Number(data.completed) || 0,
            failed: Number(data.failed) || 0,
            status: (data.status as CampaignProgress['status']) || 'pending',
            startedAt: data.startedAt,
            completedAt: data.completedAt,
            errors: data.errors ? JSON.parse(data.errors) : undefined,
        };
    } catch (error) {
        console.error(`[Progress] Failed to get progress for ${campaignId}:`, error);
        return null;
    }
}

export async function incrementProgress(
    campaignId: string,
    field: 'completed' | 'failed',
    amount: number = 1
): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    
    try {
        const key = `progress:${campaignId}`;
        
        await redis.hincrby(key, field, amount);
        
        // Fetch status to check for completion
        const data = await redis.hgetall(key);
        
        if (!data || Object.keys(data).length === 0) return;

        const totalNum = Number(data.total) || 0;
        const completedNum = Number(data.completed) || 0;
        const failedNum = Number(data.failed) || 0;
        
        if (totalNum > 0 && (completedNum + failedNum >= totalNum)) {
            const currentStatus = data.status;
            if (currentStatus !== 'completed' && currentStatus !== 'failed') {
                 const newStatus = failedNum > 0 ? 'failed' : 'completed';
                 await redis.hset(key, { 
                     status: newStatus, 
                     completedAt: new Date().toISOString() 
                 });
            }
        }
        
    } catch (error) {
        console.error(`[Progress] Failed to increment ${field} for ${campaignId}:`, error);
    }
}

export async function clearProgress(campaignId: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    try {
        await redis.del(`progress:${campaignId}`);
    } catch (error) {
        console.error(`[Progress] Failed to clear progress for ${campaignId}:`, error);
    }
}

// =============================================================================
// JOB DEDUPLICATION (Distributed Locks)
// =============================================================================

export async function acquireLock(
    lockKey: string,
    ttlSeconds: number = 300 
): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return true; 
    
    try {
        const key = `lock:${lockKey}`;
        const value = `${Date.now()}:${Math.random()}`;
        
        // ioredis SET NX EX
        const result = await redis.set(key, value, 'NX', 'EX', ttlSeconds);
        
        return result === 'OK';
    } catch (error) {
        console.error(`[Lock] Failed to acquire lock ${lockKey}:`, error);
        return true; 
    }
}

export async function releaseLock(lockKey: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    try {
        await redis.del(`lock:${lockKey}`);
    } catch (error) {
        console.error(`[Lock] Failed to release lock ${lockKey}:`, error);
    }
}

export async function isLocked(lockKey: string): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return false;
    try {
        const exists = await redis.exists(`lock:${lockKey}`);
        return exists === 1;
    } catch (error) {
        console.error(`[Lock] Failed to check lock ${lockKey}:`, error);
        return false;
    }
}

export async function isCampaignRendering(campaignId: string): Promise<boolean> {
    return isLocked(`render:${campaignId}`);
}
