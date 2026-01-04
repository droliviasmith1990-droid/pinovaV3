import { Redis } from '@upstash/redis';

/**
 * Upstash Redis Client
 * 
 * Uses environment variables from Vercel:
 * - KV_REST_API_URL
 * - KV_REST_API_TOKEN
 * 
 * For local development, add these to .env.local
 * If credentials are missing, caching is skipped gracefully.
 */

// Singleton pattern - create once, reuse everywhere
let redis: Redis | null = null;
let redisAvailable: boolean | null = null;

export function getRedis(): Redis | null {
    // Only check once
    if (redisAvailable === false) return null;
    
    if (!redis) {
        const url = process.env.KV_REST_API_URL;
        const token = process.env.KV_REST_API_TOKEN;
        
        if (!url || !token) {
            console.log('[Redis] Credentials not found - caching disabled');
            redisAvailable = false;
            return null;
        }
        
        redis = new Redis({
            url,
            token,
        });
        redisAvailable = true;
    }
    
    return redis;
}

// =============================================================================
// CACHE UTILITIES
// =============================================================================

/**
 * Cache wrapper with TTL (Time To Live)
 * If Redis is not available, just calls the fallback directly.
 * 
 * @example
 * const fonts = await cacheGet('fonts:all', async () => {
 *     return await db.query('SELECT * FROM fonts');
 * }, 3600); // Cache for 1 hour
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
        const cached = await redis.get<T>(key);
        if (cached !== null) {
            console.log(`[Cache] HIT: ${key}`);
            return cached;
        }
        
        // Cache miss - get fresh data
        console.log(`[Cache] MISS: ${key}`);
        const fresh = await fallback();
        
        // Store in cache with TTL
        await redis.setex(key, ttlSeconds, fresh);
        
        return fresh;
    } catch (error) {
        console.error(`[Cache] Error for ${key}:`, error);
        // Fallback to fresh data on error
        return fallback();
    }
}

/**
 * Invalidate a cache key or pattern
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
 * 
 * @example
 * await cacheInvalidatePattern('fonts:*'); // Clear all font caches
 */
export async function cacheInvalidatePattern(pattern: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    
    try {
        const keys = await redis.keys(pattern);
        
        if (keys.length > 0) {
            await redis.del(...keys);
            console.log(`[Cache] Invalidated ${keys.length} keys matching: ${pattern}`);
        }
    } catch (error) {
        console.error(`[Cache] Failed to invalidate pattern ${pattern}:`, error);
    }
}

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * Simple rate limiter using sliding window
 * Returns true if allowed, false if rate limit exceeded.
 * If Redis is unavailable, always returns true (no rate limiting).
 * 
 * @example
 * const allowed = await checkRateLimit('generate:user123', 10, 60); // 10 per minute
 * if (!allowed) throw new Error('Rate limit exceeded');
 */
export async function checkRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number
): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return true; // No rate limiting if Redis unavailable
    
    try {
        const now = Date.now();
        const windowKey = `ratelimit:${key}`;
        
        // Remove old entries and count current window
        await redis.zremrangebyscore(windowKey, 0, now - (windowSeconds * 1000));
        const count = await redis.zcard(windowKey);
        
        if (count >= maxRequests) {
            console.log(`[RateLimit] Exceeded: ${key} (${count}/${maxRequests})`);
            return false;
        }
        
        // Add current request
        await redis.zadd(windowKey, { score: now, member: `${now}` });
        await redis.expire(windowKey, windowSeconds);
        
        return true;
    } catch (error) {
        console.error(`[RateLimit] Redis error, allowing request:`, error);
        return true; // Allow request on Redis failure
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

/**
 * Set campaign generation progress using Redis Hash
 * 
 * @example
 * await setProgress('campaign-123', { completed: 50, total: 100, status: 'processing' });
 */
export async function setProgress(
    campaignId: string,
    progress: Partial<CampaignProgress>
): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    
    try {
        const key = `progress:${campaignId}`;
        
        // Build the hash fields to set
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
        
        // Store as hash with 24-hour TTL
        await redis.hset(key, hashData);
        await redis.expire(key, 86400);
    } catch (error) {
        console.error(`[Progress] Failed to set progress for ${campaignId}:`, error);
    }
}

/**
 * Get campaign generation progress from Redis Hash
 * 
 * @example
 * const progress = await getProgress('campaign-123');
 * console.log(`${progress.completed}/${progress.total} pins generated`);
 */
export async function getProgress(campaignId: string): Promise<CampaignProgress | null> {
    const redis = getRedis();
    if (!redis) return null;
    
    try {
        const key = `progress:${campaignId}`;
        const data = await redis.hgetall(key);
        
        if (!data || Object.keys(data).length === 0) {
            return null;
        }
        
        return {
            campaignId: (data.campaignId as string) || campaignId,
            total: Number(data.total) || 0,
            completed: Number(data.completed) || 0,
            failed: Number(data.failed) || 0,
            status: (data.status as CampaignProgress['status']) || 'pending',
            startedAt: data.startedAt as string | undefined,
            completedAt: data.completedAt as string | undefined,
            errors: data.errors ? JSON.parse(data.errors as string) : undefined,
        };
    } catch (error) {
        console.error(`[Progress] Failed to get progress for ${campaignId}:`, error);
        return null;
    }
}


/**
 * Increment completed count atomically using Redis HINCRBY
 * 
 * Uses a hash structure for atomic increments to prevent race conditions
 * when multiple batches update progress concurrently.
 */
export async function incrementProgress(
    campaignId: string,
    field: 'completed' | 'failed',
    amount: number = 1
): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    
    try {
        const key = `progress:${campaignId}`;
        
        // Use HINCRBY for atomic increment
        await redis.hincrby(key, field, amount);
        
        // OPTIMIZATION: Use HGETALL to fetch status in ONE command instead of 3
        const data = await redis.hgetall(key);
        
        if (!data || Object.keys(data).length === 0) return;

        const totalNum = Number(data.total) || 0;
        const completedNum = Number(data.completed) || 0;
        const failedNum = Number(data.failed) || 0;
        
        // Auto-complete if all done (and not already marked)
        if (totalNum > 0 && (completedNum + failedNum >= totalNum)) {
            const currentStatus = data.status as string;
            if (currentStatus !== 'completed' && currentStatus !== 'failed') {
                 const newStatus = failedNum > 0 ? 'failed' : 'completed';
                 await redis.hset(key, { 
                     status: newStatus, 
                     completedAt: new Date().toISOString() 
                 });
            }
        }
        
        // Ensure TTL is set (24 hours) - only if we suspect it's missing (optimize: skip often?)
        // Actually, expire is cheap, but let's do it only on completion or start to save ops?
        // Let's keep it for safety, but maybe we can depend on setProgress doing it.
        // For now, removing the explicit expire on EVERY increment to save 1 command per update.
        // It was set in setProgress initially.
        // await redis.expire(key, 86400); 
        
    } catch (error) {
        // Log but don't throw - progress tracking is non-critical
        console.error(`[Progress] Failed to increment ${field} for ${campaignId}:`, error);
    }
}


/**
 * Clear campaign progress (after completion or cleanup)
 */
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

/**
 * Acquire a distributed lock for a job
 * Prevents duplicate processing of the same job across workers
 * 
 * @example
 * const acquired = await acquireLock(`render:${campaignId}`, 300);
 * if (!acquired) {
 *     console.log('Job already running');
 *     return;
 * }
 * try {
 *     // Do work
 * } finally {
 *     await releaseLock(`render:${campaignId}`);
 * }
 */
export async function acquireLock(
    lockKey: string,
    ttlSeconds: number = 300 // Default 5 minutes
): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return true; // No Redis = no locking (allow all)
    
    try {
        const key = `lock:${lockKey}`;
        const value = `${Date.now()}:${Math.random()}`;
        
        // SET NX (only if not exists) with expiry
        const result = await redis.set(key, value, { nx: true, ex: ttlSeconds });
        
        return result === 'OK';
    } catch (error) {
        console.error(`[Lock] Failed to acquire lock ${lockKey}:`, error);
        return true; // Allow on error to prevent blocking
    }
}

/**
 * Release a distributed lock
 */
export async function releaseLock(lockKey: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    
    try {
        await redis.del(`lock:${lockKey}`);
    } catch (error) {
        console.error(`[Lock] Failed to release lock ${lockKey}:`, error);
    }
}

/**
 * Check if a lock is currently held
 */
export async function isLocked(lockKey: string): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return false;
    
    try {
        const exists = await redis.exists(`lock:${lockKey}`);
        return exists === 1;
    } catch (error) {
        console.error(`[Lock] Failed to check lock ${lockKey}:`, error);
        return false; // Assume not locked on error
    }
}

/**
 * Check if a campaign is currently being rendered
 * Convenience wrapper for common use case
 */
export async function isCampaignRendering(campaignId: string): Promise<boolean> {
    return isLocked(`render:${campaignId}`);
}
