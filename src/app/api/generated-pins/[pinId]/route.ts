import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, getBucket } from '@/lib/s3';

// Initialize Supabase client - with fallback to anon key
function getSupabaseClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('[delete-pin] Missing Supabase configuration:', {
            hasUrl: !!supabaseUrl,
            hasKey: !!supabaseKey
        });
        return null;
    }

    return createClient(supabaseUrl, supabaseKey);
}

// DELETE /api/generated-pins/[pinId] - Delete a single pin
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ pinId: string }> }
) {
    let pinId: string;

    try {
        const resolvedParams = await params;
        pinId = resolvedParams.pinId;
    } catch (error) {
        console.error('[delete-pin] Error resolving params:', error);
        return NextResponse.json(
            { success: false, error: 'Invalid request parameters' },
            { status: 400 }
        );
    }

    console.log(`[delete-pin] Starting deletion for pin: ${pinId}`);

    try {
        const supabase = getSupabaseClient();

        if (!supabase) {
            return NextResponse.json(
                { success: false, error: 'Database configuration error' },
                { status: 500 }
            );
        }

        console.log(`[delete-pin] Looking up pin in database...`);

        // Get the pin to find the image URL and campaign_id
        const { data: pin, error: fetchError } = await supabase
            .from('generated_pins')
            .select('*')
            .eq('id', pinId)
            .single();

        if (fetchError) {
            console.error('[delete-pin] Fetch error:', fetchError.message);
            return NextResponse.json(
                { success: false, error: `Pin not found: ${fetchError.message}` },
                { status: 404 }
            );
        }

        if (!pin) {
            return NextResponse.json(
                { success: false, error: 'Pin not found' },
                { status: 404 }
            );
        }

        console.log(`[delete-pin] Pin found, campaign_id: ${pin.campaign_id}`);

        // Try to delete from S3 if there's an image URL (optional, don't fail if S3 not configured)
        if (pin.image_url) {
            const s3Client = createS3Client();
            const bucket = getBucket();

            if (s3Client) {
                try {
                    // Extract key from URL — works for any S3-compatible storage URL
                    const url = new URL(pin.image_url);
                    
                    // Only attempt deletion if URL points to our current storage
                    // Old URLs from a previous provider (e.g. Tebi) can't be deleted via our MinIO client
                    const storagePublicUrl = process.env.STORAGE_PUBLIC_URL || '147.93.5.32';
                    if (!pin.image_url.includes(storagePublicUrl.replace(/^https?:\/\//, ''))) {
                        console.log('[delete-pin] Skipping S3 deletion - URL points to old/different storage:', pin.image_url.substring(0, 60));
                    } else {
                        let key = url.pathname.startsWith('/')
                            ? url.pathname.slice(1)
                            : url.pathname;

                        // If the path includes the bucket name as prefix, strip it
                        if (key.startsWith(`${bucket}/`)) {
                            key = key.slice(bucket.length + 1);
                        }

                        console.log(`[delete-pin] Deleting S3 object: ${key}`);

                        await s3Client.send(new DeleteObjectCommand({
                            Bucket: bucket,
                            Key: key,
                        }));

                        console.log('[delete-pin] S3 object deleted');
                    }
                } catch (s3Error) {
                    // Log but don't fail - S3 deletion is optional
                    console.warn('[delete-pin] S3 deletion failed (non-fatal):', s3Error);
                }
            } else {
                console.log('[delete-pin] Skipping S3 deletion - not configured');
            }
        }

        // Delete from database
        console.log('[delete-pin] Deleting from database...');

        const { error: deleteError } = await supabase
            .from('generated_pins')
            .delete()
            .eq('id', pinId);

        if (deleteError) {
            console.error('[delete-pin] Database delete error:', deleteError.message);
            return NextResponse.json(
                { success: false, error: `Database error: ${deleteError.message}` },
                { status: 500 }
            );
        }

        console.log('[delete-pin] Deleted from database successfully');

        // Update campaign generated_pins count (optional)
        if (pin.campaign_id) {
            try {
                const { data: campaign } = await supabase
                    .from('campaigns')
                    .select('generated_pins')
                    .eq('id', pin.campaign_id)
                    .single();

                if (campaign && typeof campaign.generated_pins === 'number' && campaign.generated_pins > 0) {
                    await supabase
                        .from('campaigns')
                        .update({
                            generated_pins: campaign.generated_pins - 1,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', pin.campaign_id);
                    console.log('[delete-pin] Campaign count updated');
                }
            } catch (campaignError) {
                // Non-fatal - just log
                console.warn('[delete-pin] Failed to update campaign count:', campaignError);
            }
        }

        console.log(`[delete-pin] Pin ${pinId} deleted successfully`);

        return NextResponse.json({
            success: true,
            message: 'Pin deleted successfully'
        });

    } catch (error) {
        console.error('[delete-pin] Unexpected error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
