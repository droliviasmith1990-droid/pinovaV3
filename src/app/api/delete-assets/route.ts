// API Route: Delete Assets
// DELETE /api/delete-assets
// Deletes assets from storage (thumbnails, campaign pins)
// SECURITY: Uses authenticated session to verify user ownership

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import {
    deleteFromS3,
    deleteObjectsWithPrefix,
    getThumbnailKey,
    getCampaignPinsPrefix,
    getApiPinsPrefix,
    isStorageConfigured,
} from '@/lib/s3';

interface DeleteAssetsRequest {
    type: 'thumbnail' | 'campaign';
    templateId?: string;  // Required for thumbnail
    campaignId?: string;  // Required for campaign
}

// SECURITY: Get authenticated Supabase client using auth header OR cookies
async function getAuthenticatedSupabase() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        return null;
    }

    // Get auth token from cookies or Authorization header
    const cookieStore = await cookies();
    const headersStore = await headers();
    
    // Check for Authorization header (Bearer token)
    const authHeader = headersStore.get('authorization');
    
    const options: { global: { headers: Record<string, string> } } = {
        global: {
            headers: {}
        }
    };

    if (authHeader) {
        // Use explicitly provided token
        options.global.headers['Authorization'] = authHeader;
    } else {
        // Fallback to cookies
        const allCookies = cookieStore.getAll();
        
        if (allCookies.length > 0) {
             options.global.headers['Cookie'] = allCookies.map(c => `${c.name}=${c.value}`).join('; ');
        }
    }

    return createClient(supabaseUrl, supabaseAnonKey, options);
}

export async function DELETE(request: NextRequest) {
    try {
        // Check if storage is configured
        if (!isStorageConfigured()) {
            return NextResponse.json(
                { error: 'Storage not configured' },
                { status: 503 }
            );
        }

        // SECURITY: Verify user session
        const supabase = await getAuthenticatedSupabase();
        if (!supabase) {
            return NextResponse.json(
                { error: 'Server configuration error' },
                { status: 503 }
            );
        }

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // SECURITY: Use authenticated user ID, not client-provided value
        const userId = user.id;

        // Parse request body
        const body: DeleteAssetsRequest = await request.json();
        const { type, templateId, campaignId } = body;

        // Validate required fields
        if (!type) {
            return NextResponse.json(
                { error: 'Missing required field: type' },
                { status: 400 }
            );
        }

        let success = false;

        switch (type) {
            case 'thumbnail':
                if (!templateId) {
                    return NextResponse.json(
                        { error: 'templateId is required for thumbnail deletion' },
                        { status: 400 }
                    );
                }
                const thumbnailKey = getThumbnailKey(userId, templateId);
                success = await deleteFromS3(thumbnailKey);
                break;

            case 'campaign':
                if (!campaignId) {
                    return NextResponse.json(
                        { error: 'campaignId is required for campaign deletion' },
                        { status: 400 }
                    );
                }
                // Delete from BOTH paths: worker-generated and API-uploaded pins
                const workerPrefix = getCampaignPinsPrefix(userId, campaignId);
                const apiPrefix = getApiPinsPrefix(campaignId);
                const [workerResult, apiResult] = await Promise.all([
                    deleteObjectsWithPrefix(workerPrefix),
                    deleteObjectsWithPrefix(apiPrefix),
                ]);
                success = workerResult && apiResult;
                break;

            default:
                return NextResponse.json(
                    { error: 'Invalid type. Must be "thumbnail" or "campaign"' },
                    { status: 400 }
                );
        }

        if (!success) {
            return NextResponse.json(
                { error: 'Failed to delete assets' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            type,
        });
    } catch (error) {
        console.error('Error in delete-assets:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
