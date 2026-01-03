// API Route: Upload Generated Pin
// POST /api/upload-pin
// Uploads generated pin image to Tebi S3 using streaming

import { NextRequest, NextResponse } from 'next/server';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { UploadPinMetadataSchema, validateRequest } from '@/lib/validations';

// Route Segment Config: Increase body size limit to 10MB
export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds timeout for large uploads

// Debug logging - only in development
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => DEBUG && console.log(...args);

// Check if S3/Tebi is configured
function isTebiConfigured(): boolean {
    return !!(
        process.env.TEBI_ENDPOINT &&
        process.env.TEBI_ACCESS_KEY &&
        process.env.TEBI_SECRET_KEY &&
        process.env.TEBI_BUCKET
    );
}

// Create S3 client for Tebi
function createS3Client(): S3Client | null {
    if (!isTebiConfigured()) return null;

    let endpoint = process.env.TEBI_ENDPOINT!;
    // Ensure properly formatted endpoint
    if (!endpoint.startsWith('http')) {
        endpoint = `https://${endpoint}`;
    }

    return new S3Client({
        endpoint,
        region: 'us-east-1',
        credentials: {
            accessKeyId: process.env.TEBI_ACCESS_KEY!,
            secretAccessKey: process.env.TEBI_SECRET_KEY!,
        },
        forcePathStyle: true,
    });
}

export async function POST(request: NextRequest) {
    log('[upload-pin] Route handler started');

    try {
        // Check if Tebi is configured
        if (!isTebiConfigured()) {
            log('[upload-pin] Tebi not configured');
            return NextResponse.json(
                { error: 'Storage not configured', details: 'Missing TEBI environment variables' },
                { status: 503 }
            );
        }

        // Parse FormData
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const campaignId = formData.get('campaign_id') as string | null;
        const rowIndexStr = formData.get('row_index') as string | null;

        log('[upload-pin] Received:', { campaignId, rowIndexStr, hasFile: !!file });

        // Validate file presence
        if (!file) {
            log('[upload-pin] Missing file');
            return NextResponse.json(
                { error: 'Missing required field: file' },
                { status: 400 }
            );
        }

        // Validate metadata with Zod schema
        const validation = validateRequest(UploadPinMetadataSchema, {
            campaign_id: campaignId,
            row_index: rowIndexStr,
        });

        if (!validation.success) {
            log('[upload-pin] Validation failed:', validation.error);
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error },
                { status: 400 }
            );
        }

        const { campaign_id, row_index: rowIndex } = validation.data;

        // Validate file size (max 10MB) - check before streaming
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            log('[upload-pin] File too large:', file.size);
            return NextResponse.json(
                { error: 'Image too large. Maximum size is 10MB.' },
                { status: 400 }
            );
        }

        // Create S3 client
        const s3Client = createS3Client();
        if (!s3Client) {
            log('[upload-pin] Failed to create S3 client');
            return NextResponse.json(
                { error: 'Failed to initialize storage client' },
                { status: 500 }
            );
        }

        // Generate S3 key
        const timestamp = Date.now();
        // Determine extension from mime type
        let extension = 'png';
        if (file.type === 'image/jpeg') extension = 'jpg';
        else if (file.type === 'image/webp') extension = 'webp';
        
        const key = `pins/${campaign_id}/${rowIndex}-${timestamp}.${extension}`;
        const bucket = process.env.TEBI_BUCKET!;

        log('[upload-pin] Uploading to:', { bucket, key, contentType: file.type });

        // PERFORMANCE: Stream upload instead of buffering entire file in memory
        // Convert Web Stream to Node.js Readable stream for AWS SDK
        const fileStream = Readable.fromWeb(file.stream() as unknown as import('stream/web').ReadableStream);

        // Use @aws-sdk/lib-storage Upload for better streaming support
        const upload = new Upload({
            client: s3Client,
            params: {
                Bucket: bucket,
                Key: key,
                Body: fileStream,
                ContentType: file.type || `image/${extension}`,
                ACL: 'public-read',
                ContentLength: file.size, // Helps S3 know size upfront
            },
        });

        await upload.done();

        // Generate public URL
        const endpoint = process.env.TEBI_ENDPOINT || 's3.tebi.io';
        const baseUrl = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
        const url = `${baseUrl}/${bucket}/${key}`;

        log('[upload-pin] Upload successful:', url);

        return NextResponse.json({
            success: true,
            url,
            key,
            rowIndex,
        });
    } catch (error) {
        console.error('[upload-pin] Error:', error);
        return NextResponse.json(
            {
                error: 'Upload failed',
                details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}
