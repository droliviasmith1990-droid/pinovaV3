import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { uploadToS3, isStorageConfigured } from '@/lib/s3';

// Allowed file types and max size
const ALLOWED_TYPES = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/jpg'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * POST /api/upload-background
 * Upload a background image (SVG, PNG, JPG) for Canva imports
 */
export async function POST(request: NextRequest) {
    console.log('[upload-background] Received upload request');

    try {
        // Check if S3 is configured
        if (!isStorageConfigured()) {
            console.error('[upload-background] Storage not configured');
            return NextResponse.json(
                { success: false, error: 'Storage not configured. Please check STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY in .env.local' },
                { status: 500 }
            );
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json(
                { success: false, error: 'No file provided' },
                { status: 400 }
            );
        }

        console.log('[upload-background] File:', {
            name: file.name,
            type: file.type,
            size: file.size
        });

        // Validate file type
        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Invalid file type. Please upload SVG, PNG, or JPG.'
                },
                { status: 400 }
            );
        }

        // Validate file size
        if (file.size > MAX_SIZE) {
            return NextResponse.json(
                {
                    success: false,
                    error: `File too large. Maximum size is ${MAX_SIZE / 1024 / 1024}MB.`
                },
                { status: 400 }
            );
        }

        // Generate unique filename
        const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
        const uniqueId = crypto.randomUUID();
        const key = `backgrounds/${uniqueId}.${extension}`;

        // Read file buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Upload to S3 using existing utility
        console.log('[upload-background] Uploading to S3:', key);
        const url = await uploadToS3(key, buffer, file.type);

        if (!url) {
            console.error('[upload-background] Upload failed - no URL returned');
            return NextResponse.json(
                { success: false, error: 'Upload failed' },
                { status: 500 }
            );
        }

        console.log('[upload-background] Upload successful:', url);

        // Determine file type for BackgroundImage
        let fileType: 'svg' | 'png' | 'jpg' = 'png';
        if (file.type === 'image/svg+xml') {
            fileType = 'svg';
        } else if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
            fileType = 'jpg';
        }

        return NextResponse.json({
            success: true,
            url,
            type: fileType,
            originalFilename: file.name,
            size: file.size
        });

    } catch (error) {
        console.error('[upload-background] Full error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        console.error('[upload-background] Error message:', errorMessage);
        return NextResponse.json(
            { success: false, error: errorMessage },
            { status: 500 }
        );
    }
}
