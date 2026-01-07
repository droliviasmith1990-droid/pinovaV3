/**
 * Thumbnail URL Utilities
 * 
 * Cache-busting and URL manipulation for template thumbnails.
 */

/**
 * Generate cache-busted thumbnail URL using Unix epoch timestamp.
 * Only applies to internal S3/Tebi.io URLs, not external images.
 * 
 * @param thumbnailUrl - The original thumbnail URL
 * @param updatedAt - ISO timestamp string (from database updated_at field)
 * @returns Cache-busted URL or original URL if not applicable
 */
export function getCacheBustedThumbnailUrl(
    thumbnailUrl: string | null | undefined,
    updatedAt: string | null | undefined
): string | null {
    if (!thumbnailUrl) return null;
    
    // Only add cache-buster to internal storage URLs
    const isInternalUrl = thumbnailUrl.includes('tebi.io') || 
                          thumbnailUrl.includes('s3.') ||
                          thumbnailUrl.includes('/thumbnails/');
    
    if (!isInternalUrl || !updatedAt) return thumbnailUrl;
    
    // Use Unix epoch timestamp for clean URL-safe parameter
    const timestamp = new Date(updatedAt).getTime();
    const separator = thumbnailUrl.includes('?') ? '&' : '?';
    
    return `${thumbnailUrl}${separator}v=${timestamp}`;
}
