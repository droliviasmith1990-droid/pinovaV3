/**
 * ImageCache - Preloads and caches images for bulk pin generation
 * 
 * This dramatically improves batch rendering performance by:
 * 1. Loading each unique image URL only ONCE
 * 2. Caching as HTMLImageElement for instant reuse
 * 3. Allowing parallel preloading of all images before rendering
 * 
 * @example
 * const cache = new ImagePreloadCache();
 * const urls = ['https://example.com/bg.jpg', 'https://example.com/logo.png'];
 * await cache.preloadAll(urls); // Load all images upfront
 * 
 * const img = cache.get(urls[0]); // Instant retrieval
 */

export class ImagePreloadCache {
    private cache: Map<string, HTMLImageElement> = new Map();
    private loadingPromises: Map<string, Promise<HTMLImageElement | null>> = new Map();
    private stats = { hits: 0, misses: 0, preloaded: 0, failed: 0 };

    /**
     * Preload multiple image URLs in parallel
     */
    async preloadAll(urls: string[]): Promise<void> {
        // SSR Safety: Only run in browser
        if (typeof window === 'undefined') {
            console.warn('[ImageCache] Skipping preload - not in browser context');
            return;
        }

        const uniqueUrls = [...new Set(urls.filter(url => url && !this.cache.has(url)))];
        
        if (uniqueUrls.length === 0) {
            console.log('[ImageCache] All images already cached');
            return;
        }

        console.log(`[ImageCache] Preloading ${uniqueUrls.length} unique images...`);
        const startTime = Date.now();

        const results = await Promise.allSettled(
            uniqueUrls.map(url => this.loadImage(url))
        );

        const succeeded = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
        const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === null)).length;
        
        this.stats.preloaded += succeeded;
        this.stats.failed += failed;

        console.log(`[ImageCache] Preloaded ${succeeded} images, ${failed} failed in ${Date.now() - startTime}ms`);
    }

    /**
     * Load a single image (with caching and deduplication)
     */
    private async loadImage(url: string): Promise<HTMLImageElement | null> {
        // Return cached image if available
        if (this.cache.has(url)) {
            return this.cache.get(url)!;
        }

        // Return existing loading promise to prevent duplicate loads
        if (this.loadingPromises.has(url)) {
            return this.loadingPromises.get(url)!;
        }

        // Create new loading promise
        const loadPromise = new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';

            const timeout = setTimeout(() => {
                console.warn(`[ImageCache] Timeout loading: ${url.substring(0, 60)}...`);
                img.src = ''; // Cancel the request
                this.loadingPromises.delete(url);
                resolve(null);
            }, 30000); // 30 second timeout

            img.onload = () => {
                clearTimeout(timeout);
                this.cache.set(url, img);
                this.loadingPromises.delete(url);
                resolve(img);
            };

            img.onerror = (error) => {
                clearTimeout(timeout);
                console.warn(`[ImageCache] Failed to load: ${url.substring(0, 60)}...`, error);
                this.loadingPromises.delete(url);
                resolve(null);
            };

            // Set image source - URL should already be in final form (with proxy if needed)
            img.src = url;
        });

        this.loadingPromises.set(url, loadPromise);
        return loadPromise;
    }

    /**
     * Get a cached image element
     */
    get(url: string): HTMLImageElement | null {
        if (this.cache.has(url)) {
            this.stats.hits++;
            return this.cache.get(url)!;
        }
        this.stats.misses++;
        
        // Debug: On first few misses, log what we're looking for vs what's cached
        if (this.stats.misses <= 3 && this.cache.size > 0) {
            const cacheKeys = Array.from(this.cache.keys()).slice(0, 3);
            console.log(`[ImageCache] Looking for: ${url.substring(0, 80)}`);
            console.log(`[ImageCache] Cache has keys like: ${cacheKeys.map(k => k.substring(0, 60)).join(', ')}`);
        }
        
        return null;
    }

    /**
     * Check if an image is cached
     */
    has(url: string): boolean {
        return this.cache.has(url);
    }

    /**
     * Clear the cache
     */
    clear(): void {
        this.cache.clear();
        this.loadingPromises.clear();
        console.log('[ImageCache] Cache cleared');
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            ...this.stats,
            cached: this.cache.size,
            loading: this.loadingPromises.size,
            hitRate: this.stats.hits + this.stats.misses > 0 
                ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1) + '%'
                : '0%',
        };
    }
}

// Singleton instance for global use
let globalImageCache: ImagePreloadCache | null = null;

export function getImageCache(): ImagePreloadCache {
    if (!globalImageCache) {
        globalImageCache = new ImagePreloadCache();
    }
    return globalImageCache;
}

export function resetImageCache(): void {
    if (globalImageCache) {
        globalImageCache.clear();
        globalImageCache = null;
    }
}

/**
 * Extract all image URLs from template elements
 * IMPORTANT: Extracted URLs must match exactly what getDynamicImageUrl() in engine.ts will request
 */
export function extractImageUrls(
    elements: Array<{ type: string; imageUrl?: string; isDynamic?: boolean; dynamicSource?: string; isCanvaBackground?: boolean }>,
    csvData?: Record<string, string>[],
    fieldMapping?: Record<string, string>
): string[] {
    const urls: string[] = [];
    const seen = new Set<string>();
    
    // Helper: Validate URL
    const isValidUrl = (url: string): boolean => {
        if (!url || url.trim() === '') return false;
        // Must be http/https URL, data URL, or proxy URL
        return url.startsWith('http') || url.startsWith('data:') || url.startsWith('/api/');
    };

    console.log('[extractImageUrls] Starting extraction...', {
        elementCount: elements.length,
        imageElements: elements.filter(el => el.type === 'image').length,
        csvRows: csvData?.length || 0
    });

    for (const el of elements) {
        if (el.type !== 'image') continue;
        
        // Debug: Log element properties
        console.log('[extractImageUrls] Image element:', {
            isDynamic: el.isDynamic,
            dynamicSource: el.dynamicSource,
            imageUrl: el.imageUrl?.substring(0, 50),
            isCanvaBackground: el.isCanvaBackground
        });

        // Static image URL (including Canva backgrounds)
        if (el.imageUrl && !el.isDynamic) {
            let finalUrl = el.imageUrl;

            // For Canva backgrounds, apply proxy logic to match getDynamicImageUrl
            // ONLY check for proxy if NOT on our storage, as MinIO has CORS enabled
            if (el.isCanvaBackground && !el.imageUrl.includes('147.93.5.32') && !el.imageUrl.includes('public.blob.vercel-storage.com')) {
                // If already a proxy URL or data URL, use as-is
                if (el.imageUrl.startsWith('/api/proxy-image') || el.imageUrl.startsWith('data:')) {
                    finalUrl = el.imageUrl;
                } else {
                    // Check if URL appears to already be encoded
                    const needsEncoding = !el.imageUrl.includes('%3A') && !el.imageUrl.includes('%2F');
                    finalUrl = `/api/proxy-image?url=${needsEncoding ? encodeURIComponent(el.imageUrl) : el.imageUrl}`;
                }
            }

            if (isValidUrl(finalUrl) && !seen.has(finalUrl)) {
                urls.push(finalUrl);
                seen.add(finalUrl);
                console.log('[extractImageUrls] Added static image:', finalUrl.substring(0, 80));
            }
        }

        // Dynamic images - extract unique URLs from CSV data
        if (el.isDynamic && el.dynamicSource && csvData && fieldMapping) {
            const col = fieldMapping[el.dynamicSource] || el.dynamicSource;
            console.log(`[extractImageUrls] Processing dynamic element with source: ${el.dynamicSource}, column: ${col}`);
            
            let addedCount = 0;
            for (const row of csvData) {
                const dynamicUrl = row[col];
                if (dynamicUrl && isValidUrl(dynamicUrl) && !seen.has(dynamicUrl)) {
                    urls.push(dynamicUrl);
                    seen.add(dynamicUrl);
                    addedCount++;
                    
                    // Safety limit: Stop if we've added too many unique URLs from one source
                    if (addedCount > 500) {
                        console.warn(`[extractImageUrls] Hit safety limit (500) for dynamic source: ${el.dynamicSource}`);
                        break;
                    }
                }
            }
            console.log(`[extractImageUrls] Added ${addedCount} unique URLs for dynamic source: ${el.dynamicSource}`);
        }
    }
    
    // Final safety check: Cap total URLs at 1000
    if (urls.length > 1000) {
        console.warn(`[extractImageUrls] Extracted ${urls.length} URLs - capping at 1000 to prevent memory issues`);
        urls.splice(1000);
    }

    console.log(`[extractImageUrls] Final count: ${urls.length} unique URLs`);
    return urls;
}
