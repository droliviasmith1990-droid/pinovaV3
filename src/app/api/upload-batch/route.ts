// API Route: Batch Upload Generated Pins
// POST /api/upload-batch
// Uploads multiple pins in a single request for 10x faster generation

import { NextRequest, NextResponse } from 'next/server';
import { isStorageConfigured, uploadToS3 } from '@/lib/s3';

// Route Segment Config
export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes timeout for batch uploads

// Debug logging - only in development
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => DEBUG && console.log('[upload-batch]', ...args);

// Pin data structure for batch upload
interface BatchPinData {
    pinNumber: number;
    imageData: string; // base64 data URL
    fileName: string;
}

interface BatchUploadRequest {
    campaignId: string;
    pins: BatchPinData[];
}

interface BatchUploadResult {
    pinNumber: number;
    success: boolean;
    url?: string;
    key?: string;
    error?: string;
}

export async function POST(request: NextRequest) {
    const startTime = Date.now();
    log('Batch upload started');

    try {
        // Check if storage is configured
        if (!isStorageConfigured()) {
            log('Storage not configured');
            return NextResponse.json(
                { error: 'Storage not configured', details: 'Missing STORAGE environment variables' },
                { status: 503 }
            );
        }

        // Parse request body
        const body: BatchUploadRequest = await request.json();
        const { campaignId, pins } = body;

        if (!campaignId || !pins || !Array.isArray(pins)) {
            return NextResponse.json(
                { error: 'Invalid request', details: 'Missing campaignId or pins array' },
                { status: 400 }
            );
        }

        log(`Processing batch of ${pins.length} pins for campaign ${campaignId}`);

        // Upload all pins in parallel using shared uploadToS3
        const results: BatchUploadResult[] = await Promise.all(
            pins.map(async (pin): Promise<BatchUploadResult> => {
                try {
                    // Convert base64 data URL to buffer
                    const base64Data = pin.imageData.replace(/^data:image\/\w+;base64,/, '');
                    const buffer = Buffer.from(base64Data, 'base64');

                    // Determine content type from data URL
                    const contentType = pin.imageData.startsWith('data:image/jpeg')
                        ? 'image/jpeg'
                        : 'image/png';

                    // Generate S3 key
                    const timestamp = Date.now();
                    const extension = contentType === 'image/jpeg' ? 'jpg' : 'png';
                    const key = `pins/${campaignId}/${pin.pinNumber}-${timestamp}.${extension}`;

                    // Upload via shared module
                    const url = await uploadToS3(key, buffer, contentType);

                    if (!url) {
                        return {
                            pinNumber: pin.pinNumber,
                            success: false,
                            error: 'Upload returned null',
                        };
                    }

                    return {
                        pinNumber: pin.pinNumber,
                        success: true,
                        url,
                        key,
                    };
                } catch (error) {
                    console.error(`[upload-batch] Failed to upload pin ${pin.pinNumber}:`, error);
                    return {
                        pinNumber: pin.pinNumber,
                        success: false,
                        error: error instanceof Error ? error.message : 'Upload failed',
                    };
                }
            })
        );

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        const elapsed = Date.now() - startTime;

        log(`Batch completed: ${successCount} success, ${failCount} failed in ${elapsed}ms`);

        return NextResponse.json({
            success: true,
            results,
            stats: {
                total: pins.length,
                successful: successCount,
                failed: failCount,
                durationMs: elapsed,
            },
        });
    } catch (error) {
        console.error('[upload-batch] Error:', error);
        return NextResponse.json(
            {
                error: 'Batch upload failed',
                details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}
