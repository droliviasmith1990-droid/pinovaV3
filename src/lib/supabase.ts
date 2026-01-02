/**
 * Supabase Client Configuration
 * 
 * Centralizes Supabase client creation and authentication helpers.
 * All database operations should use these helpers for consistency.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Note: Database types are available in @/types/database.types 
// Once the schema is fully aligned, we can use: createClient<Database>(url, key)

// ============================================
// Environment Configuration
// ============================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

// Log warnings in development only
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    if (!supabaseUrl) {
        console.warn('[Supabase] NEXT_PUBLIC_SUPABASE_URL is not set. Database features will not work.');
    }
    if (!supabaseAnonKey) {
        console.warn('[Supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Database features will not work.');
    }
}

// ============================================
// Supabase Client
// ============================================

/**
 * Supabase client instance
 * 
 * Note: Currently using untyped client for flexibility.
 * Database types are defined in @/types/database.types.ts for type-safe DTOs.
 */
export const supabase: SupabaseClient = createClient(
    supabaseUrl || '',
    supabaseAnonKey || '',
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
        },
    }
);
// ============================================
// Configuration Helpers
// ============================================

/**
 * Check if Supabase is properly configured
 */
export function isSupabaseConfigured(): boolean {
    return Boolean(supabaseUrl && supabaseAnonKey);
}

// ============================================
// Authentication Helpers
// ============================================

/**
 * Cache for user ID to avoid repeated auth calls
 */
let cachedUserId: string | null = null;
let cacheExpiry: number = 0;
const CACHE_DURATION_MS = 60_000; // 1 minute

/**
 * Get current authenticated user ID
 * 
 * Uses a short-lived cache to reduce auth API calls.
 * Returns null if not authenticated or Supabase is not configured.
 */
export async function getCurrentUserId(): Promise<string | null> {
    if (!isSupabaseConfigured()) return null;

    // Return cached value if still valid
    const now = Date.now();
    if (cachedUserId && now < cacheExpiry) {
        return cachedUserId;
    }

    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error) {
            console.warn('[Supabase] Auth error:', error.message);
            cachedUserId = null;
            return null;
        }

        cachedUserId = user?.id || null;
        cacheExpiry = now + CACHE_DURATION_MS;
        
        return cachedUserId;
    } catch (error) {
        console.error('[Supabase] Failed to get user:', error);
        return null;
    }
}

/**
 * Get current user with full details
 */
export async function getCurrentUser() {
    if (!isSupabaseConfigured()) return null;

    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error || !user) return null;
        
        return user;
    } catch {
        return null;
    }
}

/**
 * Clear the user ID cache (call on logout)
 */
export function clearUserCache(): void {
    cachedUserId = null;
    cacheExpiry = 0;
}

/**
 * Subscribe to auth state changes
 */
export function onAuthStateChange(
    callback: (event: 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED', userId: string | null) => void
) {
    return supabase.auth.onAuthStateChange((event, session) => {
        // Clear cache on any auth change
        clearUserCache();
        
        const userId = session?.user?.id || null;
        
        if (event === 'SIGNED_IN') {
            callback('SIGNED_IN', userId);
        } else if (event === 'SIGNED_OUT') {
            callback('SIGNED_OUT', null);
        } else if (event === 'TOKEN_REFRESHED') {
            callback('TOKEN_REFRESHED', userId);
        }
    });
}

// ============================================
// Query Helpers
// ============================================

/**
 * Check authentication and configuration before DB operations
 * @throws Error if not configured or not authenticated
 */
export async function requireAuth(): Promise<string> {
    if (!isSupabaseConfigured()) {
        throw new Error('Supabase is not configured');
    }

    const userId = await getCurrentUserId();
    if (!userId) {
        throw new Error('User not authenticated');
    }

    return userId;
}

/**
 * Check authentication and configuration, returning null if not available
 * Use this for read operations where we want to fail gracefully
 */
export async function checkAuth(): Promise<{ userId: string } | null> {
    if (!isSupabaseConfigured()) return null;

    const userId = await getCurrentUserId();
    if (!userId) return null;

    return { userId };
}
