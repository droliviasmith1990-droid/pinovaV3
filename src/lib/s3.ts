// S3-Compatible Storage Client (MinIO)
// Server-side only - uses STORAGE_* environment variables for credentials
// All env vars are read LAZILY inside functions to avoid race conditions
// with dotenv loading order in worker contexts.

import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { debugLog, debugError, debugWarn } from '@/lib/utils/debug';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// Lazy Environment Variable Getters
// ============================================

function getAccessKey(): string | undefined {
    return process.env.STORAGE_ACCESS_KEY;
}

function getSecretKey(): string | undefined {
    return process.env.STORAGE_SECRET_KEY;
}

/** Internal endpoint for S3Client connections (e.g. http://localhost:9000) */
function getEndpoint(): string {
    const endpoint = process.env.STORAGE_ENDPOINT || 'http://localhost:9000';
    if (!endpoint.startsWith('http')) {
        return `https://${endpoint}`;
    }
    return endpoint;
}

/** Public base URL for browser-accessible image URLs (e.g. http://147.93.5.32:9000) */
function getPublicBaseUrl(): string {
    const publicUrl = process.env.STORAGE_PUBLIC_URL || 'http://147.93.5.32:9000';
    if (!publicUrl.startsWith('http')) {
        return `https://${publicUrl}`;
    }
    return publicUrl;
}

function getStorageBucket(): string {
    return process.env.STORAGE_BUCKET || 'pinova-storage';
}

// ============================================
// Storage Configuration Check
// ============================================

/** Check if storage is configured */
export const isStorageConfigured = (): boolean => {
    return Boolean(getAccessKey() && getSecretKey());
};



// ============================================
// S3 Client Factory (with caching)
// ============================================

// Cache client at module level to avoid creating a new one per call
let _cachedS3Client: S3Client | null = null;
let _cachedCredentials: string | null = null;

/** Create S3 client pointing to the internal storage endpoint (cached) */
export const createS3Client = (): S3Client | null => {
    if (!isStorageConfigured()) {
        debugWarn('S3', 'Storage credentials not configured');
        return null;
    }

    // Invalidate cache if credentials changed (hot-reload scenario)
    const credentialKey = `${getAccessKey()}:${getSecretKey()}:${getEndpoint()}`;
    if (_cachedS3Client && _cachedCredentials === credentialKey) {
        return _cachedS3Client;
    }

    _cachedS3Client = new S3Client({
        region: 'auto',
        endpoint: getEndpoint(),
        credentials: {
            accessKeyId: getAccessKey()!,
            secretAccessKey: getSecretKey()!,
        },
        forcePathStyle: true, // Required for MinIO path-style access
    });
    _cachedCredentials = credentialKey;

    return _cachedS3Client;
};

// ============================================
// Public URL & Bucket Accessors
// ============================================

/** Get bucket name */
export const getBucket = (): string => getStorageBucket();

/** Get public URL for an object (browser-accessible) */
export const getPublicUrl = (key: string): string => {
    return `${getPublicBaseUrl()}/${getStorageBucket()}/${key}`;
};

// ============================================
// S3 Operations
// ============================================

/**
 * Upload a file to S3
 * @param key Object key (path in bucket)
 * @param body File content as Buffer
 * @param contentType MIME type
 * @returns Public URL of uploaded file or null on error
 */
export async function uploadToS3(
    key: string,
    body: Buffer,
    contentType: string
): Promise<string | null> {
    debugLog('S3', 'uploadToS3 called with key:', key);

    const s3Client = createS3Client();
    if (!s3Client) {
        debugError('S3', 'Failed to create S3 client');
        return null;
    }

    try {
        debugLog('S3', 'Uploading to bucket:', getBucket());
        const command = new PutObjectCommand({
            Bucket: getBucket(),
            Key: key,
            Body: body,
            ContentType: contentType,
            ACL: 'public-read',
        });

        await s3Client.send(command);
        const url = getPublicUrl(key);
        debugLog('S3', 'Upload successful, URL:', url);
        return url;
    } catch (error) {
        debugError('S3', 'Error uploading to S3:', error);
        debugError('S3', 'Error details:', error instanceof Error ? error.message : 'Unknown error');
        return null;
    }
}

/**
 * Upload a campaign-generated pin (JPEG) to S3.
 * Key format: campaigns/{campaignId}/pin-{n}-{uuid8}.jpg
 * @returns Public URL of uploaded pin or null on error
 */
export async function uploadCampaignPin(
    buffer: Buffer,
    campaignId: string,
    pinIndex: number
): Promise<string | null> {
    const key = `campaigns/${campaignId}/pin-${pinIndex}-${uuidv4().substring(0, 8)}.jpg`;
    debugLog('S3', 'uploadCampaignPin called with key:', key);

    const s3Client = createS3Client();
    if (!s3Client) {
        debugError('S3', 'Failed to create S3 client for campaign pin');
        return null;
    }

    try {
        await s3Client.send(new PutObjectCommand({
            Bucket: getBucket(),
            Key: key,
            Body: buffer,
            ContentType: 'image/jpeg',
            ACL: 'public-read',
        }));

        const url = getPublicUrl(key);
        debugLog('S3', 'Campaign pin upload successful, URL:', url);
        return url;
    } catch (error) {
        debugError('S3', 'Error uploading campaign pin:', error);
        return null;
    }
}

/**
 * Delete a file from S3
 * @param key Object key to delete
 * @returns true on success, false on error
 */
export async function deleteFromS3(key: string): Promise<boolean> {
    const s3Client = createS3Client();
    if (!s3Client) {
        return false;
    }

    try {
        const command = new DeleteObjectCommand({
            Bucket: getBucket(),
            Key: key,
        });

        await s3Client.send(command);
        return true;
    } catch (error) {
        debugError('S3', 'Error deleting from S3:', error);
        return false;
    }
}

/**
 * Delete all objects with a given prefix (bulk folder deletion).
 * Handles pagination for >1000 objects.
 * @param prefix S3 key prefix to match
 * @returns true if all deleted (or none found), false on error
 */
export async function deleteObjectsWithPrefix(prefix: string): Promise<boolean> {
    const s3Client = createS3Client();
    if (!s3Client) {
        return false;
    }

    const bucket = getBucket();

    try {
        let continuationToken: string | undefined;

        do {
            const listCommand = new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                MaxKeys: 1000,
                ContinuationToken: continuationToken,
            });

            const listResult = await s3Client.send(listCommand);

            if (!listResult.Contents || listResult.Contents.length === 0) {
                break;
            }

            const deleteCommand = new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: {
                    Objects: listResult.Contents.map(obj => ({ Key: obj.Key! })),
                    Quiet: true,
                },
            });

            await s3Client.send(deleteCommand);
            continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
        } while (continuationToken);

        return true;
    } catch (error) {
        debugError('S3', 'Error deleting objects with prefix:', prefix, error);
        return false;
    }
}

/**
 * Check if a file exists in S3
 * @param key Object key to check
 * @returns true if exists, false otherwise
 */
export async function existsInS3(key: string): Promise<boolean> {
    const s3Client = createS3Client();
    if (!s3Client) {
        return false;
    }

    try {
        const command = new HeadObjectCommand({
            Bucket: getBucket(),
            Key: key,
        });

        await s3Client.send(command);
        return true;
    } catch {
        return false;
    }
}

// ============================================
// Path Helpers
// ============================================

/**
 * Generate S3 key for template thumbnail
 */
export function getThumbnailKey(userId: string, templateId: string): string {
    return `thumbnails/${userId}/${templateId}.png`;
}

/**
 * Generate S3 key for generated pin
 */
export function getPinKey(userId: string, campaignId: string, pinNumber: number): string {
    return `pins/${userId}/${campaignId}/${pinNumber}.png`;
}

/**
 * Generate S3 key prefix for worker-generated campaign pins.
 * Matches upload path: campaigns/{campaignId}/pin-{n}-{uuid8}.jpg
 */
export function getCampaignPinsPrefix(userId: string, campaignId: string): string {
    return `campaigns/${campaignId}/`;
}

/**
 * Generate S3 key prefix for API-uploaded pins.
 * Matches upload path: pins/{campaignId}/{rowIndex}-{timestamp}.{ext}
 */
export function getApiPinsPrefix(campaignId: string): string {
    return `pins/${campaignId}/`;
}
