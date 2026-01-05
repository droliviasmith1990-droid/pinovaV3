import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import { CreateGeneratedPinSchema, validateRequest } from '@/lib/validations';

// Debug logging - only in development
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => DEBUG && console.log(...args);

// Initialize Supabase client with SERVICE ROLE KEY for writes
// This bypasses RLS and is used for server-side operations
function getServiceSupabase(): SupabaseClient | null {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('[generated-pins] Missing Supabase SERVICE_ROLE_KEY configuration');
        return null;
    }

    return createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false }
    });
}

// Initialize Supabase client with cookie-based or header-based auth
async function getAuthenticatedSupabase(): Promise<SupabaseClient | null> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error('[generated-pins] Missing Supabase configuration');
        return null;
    }

    // Get auth token from cookies or Authorization header
    const cookieStore = await cookies();
    const headersStore = await headers();
    
    // Check for Authorization header (Bearer token)
    const authHeader = headersStore.get('authorization');
    
    const options: any = {
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

    // Create client
    return createClient(supabaseUrl, supabaseAnonKey, options);
}

// ============================================
// POST: Save generated pin record
// Uses SERVICE ROLE KEY to bypass cookie auth issues on Vercel
// ============================================
export async function POST(request: NextRequest) {
    log('[generated-pins] POST request started');

    try {
        const body = await request.json();
        log('[generated-pins] POST body:', JSON.stringify(body, null, 2));

        // 1. Validate request body with Zod schema
        const validation = validateRequest(CreateGeneratedPinSchema, body);
        if (!validation.success) {
            log('[generated-pins] Validation failed:', validation.error);
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error },
                { status: 400 }
            );
        }

        const { campaign_id, user_id, image_url, data_row, status, error_message } = validation.data;

        // 2. SECURITY: Validate user_id is provided (required for service role approach)
        if (!user_id) {
            log('[generated-pins] Missing user_id in request');
            return NextResponse.json(
                { error: 'user_id is required' },
                { status: 400 }
            );
        }

        // 3. Get service role client for write operations
        const supabase = getServiceSupabase();
        if (!supabase) {
            // Fallback to cookie auth if service role not configured
            log('[generated-pins] Service role not available, trying cookie auth');
            const authSupabase = await getAuthenticatedSupabase();
            if (!authSupabase) {
                return NextResponse.json(
                    { error: 'Server configuration error' },
                    { status: 503 }
                );
            }

            // Verify user session with cookie auth
            const { data: { user }, error: authError } = await authSupabase.auth.getUser();
            if (authError || !user) {
                log('[generated-pins] Cookie auth failed:', authError?.message);
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }

            // Use authenticated user's ID
            const { data, error } = await authSupabase
                .from('generated_pins')
                .insert({
                    campaign_id,
                    user_id: user.id,
                    image_url: image_url || null,
                    data_row: data_row || null,
                    status: status || 'completed',
                    error_message: error_message || null,
                })
                .select()
                .single();

            if (error) {
                console.error('[generated-pins] Insert error:', error);
                return NextResponse.json(
                    { error: 'Failed to save generated pin', details: error.message },
                    { status: 500 }
                );
            }

            return NextResponse.json({ success: true, data }, { status: 201 });
        }

        // 4. Insert using service role (bypasses RLS)
        log('[generated-pins] Using service role, inserting for user:', user_id);
        const { data, error } = await supabase
            .from('generated_pins')
            .insert({
                campaign_id,
                user_id, // Trust user_id from validated request
                image_url: image_url || null,
                data_row: data_row || null,
                status: status || 'completed',
                error_message: error_message || null,
            })
            .select()
            .single();

        if (error) {
            console.error('[generated-pins] Insert error:', error);
            return NextResponse.json(
                { error: 'Failed to save generated pin', details: error.message },
                { status: 500 }
            );
        }

        log('[generated-pins] Pin saved successfully:', data?.id);

        // 5. Update Campaign Progress (atomic increment)
        try {
            const { error: rpcError } = await supabase.rpc('increment_campaign_pins', {
                campaign_uuid: campaign_id,
                increment_by: 1
            });

            if (rpcError) {
                // Fallback to manual update if RPC doesn't exist
                log('[generated-pins] RPC not available, using fallback:', rpcError.message);
                const { data: campaignData } = await supabase
                    .from('campaigns')
                    .select('generated_pins, current_index')
                    .eq('id', campaign_id)
                    .single();

                if (campaignData) {
                    const newCount = (campaignData.generated_pins as number || 0) + 1;
                    await supabase
                        .from('campaigns')
                        .update({
                            generated_pins: newCount,
                            current_index: newCount, // Keep both in sync
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', campaign_id);
                }
            }
        } catch (updateErr) {
            console.warn('[generated-pins] Campaign update warning:', updateErr);
        }

        return NextResponse.json({ success: true, data }, { status: 201 });
    } catch (error) {
        console.error('[generated-pins] POST error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// ============================================
// PATCH: Batch save multiple generated pins in single DB call
// Optimizes server-side rendering by eliminating N network round-trips
// ============================================
export async function PATCH(request: NextRequest) {
    log('[generated-pins] PATCH batch save started');

    try {
        const body = await request.json();
        
        // Validate batch structure
        if (!body.pins || !Array.isArray(body.pins) || body.pins.length === 0) {
            return NextResponse.json(
                { error: 'pins array is required and must not be empty' },
                { status: 400 }
            );
        }

        // Get service role client for batch operations
        const supabase = getServiceSupabase();
        if (!supabase) {
            return NextResponse.json(
                { error: 'Server configuration error' },
                { status: 503 }
            );
        }

        // Prepare batch insert data
        const pinsToInsert = body.pins.map((pin: {
            campaign_id: string;
            user_id: string;
            image_url: string;
            data_row: Record<string, string>;
            status: string;
            error_message?: string;
        }) => ({
            campaign_id: pin.campaign_id,
            user_id: pin.user_id,
            image_url: pin.image_url || null,
            data_row: pin.data_row || null,
            status: pin.status || 'completed',
            error_message: pin.error_message || null,
        }));

        log(`[generated-pins] Batch inserting ${pinsToInsert.length} pins...`);

        // Single batch insert
        const { data, error } = await supabase
            .from('generated_pins')
            .insert(pinsToInsert)
            .select();

        if (error) {
            console.error('[generated-pins] Batch insert error:', error);
            return NextResponse.json(
                { error: 'Failed to save pins', details: error.message },
                { status: 500 }
            );
        }

        // Update campaign progress with total count
        const campaignId = pinsToInsert[0]?.campaign_id;
        if (campaignId) {
            try {
                const successCount = data?.length || 0;
                
                // Use atomic RPC
                const { error: rpcError } = await supabase.rpc('increment_campaign_pins', {
                    campaign_uuid: campaignId,
                    increment_by: successCount
                });

                if (rpcError) {
                    log('[generated-pins] RPC failed, falling back to manual update:', rpcError.message);
                    // Get current count and add batch size
                    const { data: campaignData } = await supabase
                        .from('campaigns')
                        .select('generated_pins')
                        .eq('id', campaignId)
                        .single();

                    const currentCount = (campaignData?.generated_pins as number) || 0;
                    
                    await supabase
                        .from('campaigns')
                        .update({
                            generated_pins: currentCount + successCount,
                            current_index: currentCount + successCount,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', campaignId);
                }
            } catch (updateErr) {
                console.warn('[generated-pins] Campaign batch update warning:', updateErr);
            }
        }

        log(`[generated-pins] Batch saved ${data?.length || 0} pins successfully`);
        return NextResponse.json({ 
            success: true, 
            count: data?.length || 0,
            data 
        }, { status: 201 });

    } catch (error) {
        console.error('[generated-pins] PATCH error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// ============================================
// GET: Get generated pins for a campaign
// ============================================
export async function GET(request: NextRequest) {
    log('[generated-pins] GET request started');

    try {
        const supabase = await getAuthenticatedSupabase();
        if (!supabase) {
            return NextResponse.json(
                { error: 'Server configuration error' },
                { status: 503 }
            );
        }

        // Verify user session for RLS
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            console.warn('[generated-pins] Auth failed:', authError?.message || 'No user session found');
            console.warn('[generated-pins] Cookies received:', request.headers.get('cookie') ? 'Yes' : 'No');
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const campaignId = searchParams.get('campaign_id');
        log('[generated-pins] GET campaignId:', campaignId);

        if (!campaignId) {
            return NextResponse.json(
                { error: 'campaign_id is required' },
                { status: 400 }
            );
        }

        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = (page - 1) * limit;

        const fields = searchParams.get('fields') || '*';

        // RLS will automatically filter to user's own data
        log(`[generated-pins] Fetching pins (page ${page}, limit ${limit}, fields ${fields})...`);
        
        let query = supabase
            .from('generated_pins')
            .select(fields === '*' ? '*' : fields, { count: 'exact' })
            .eq('campaign_id', campaignId);

        // Apply sorting
        const sort = searchParams.get('sort') || 'created_at_desc';
        switch (sort) {
            case 'created_at_asc':
                query = query.order('created_at', { ascending: true });
                break;
            case 'row_index_desc':
                // Sort by CSV row index (high to low) using JSONB field
                query = query.order('data_row->rowIndex', { ascending: false, nullsFirst: false });
                break;
            case 'row_index_asc':
                // Sort by CSV row index (low to high) using JSONB field
                query = query.order('data_row->rowIndex', { ascending: true, nullsFirst: false });
                break;
            case 'created_at_desc':
            default:
                query = query.order('created_at', { ascending: false });
                break;
        }

        // Apply pagination only if not requesting all (limit=-1 or very high)
        // Or strictly adhere to limit
        if (limit > 0) {
            query = query.range(offset, offset + limit - 1);
        }
            
        const { data, error, count } = await query;

        if (error) {
            console.error('[generated-pins] Fetch error:', error);
            return NextResponse.json(
                { error: 'Failed to fetch generated pins', details: error.message },
                { status: 500 }
            );
        }

        log('[generated-pins] Found', data?.length || 0, 'pins (total:', count, ')');
        return NextResponse.json({ success: true, data: data || [], meta: {
            page,
            limit,
            total: count || 0,
            hasMore: (count || 0) > (page * limit)
        }});
    } catch (error) {
        console.error('[generated-pins] GET error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// ============================================
// DELETE: Delete generated pins for a campaign
// ============================================
export async function DELETE(request: NextRequest) {
    log('[generated-pins] DELETE request started');

    try {
        const supabase = await getAuthenticatedSupabase();
        if (!supabase) {
            return NextResponse.json(
                { error: 'Server configuration error' },
                { status: 503 }
            );
        }

        // Verify user session for RLS
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const campaignId = searchParams.get('campaign_id');
        log('[generated-pins] DELETE campaignId:', campaignId);

        if (!campaignId) {
            return NextResponse.json(
                { error: 'campaign_id is required' },
                { status: 400 }
            );
        }

        // RLS will ensure only user's own data can be deleted
        log('[generated-pins] Deleting pins...');
        const { error } = await supabase
            .from('generated_pins')
            .delete()
            .eq('campaign_id', campaignId);

        if (error) {
            console.error('[generated-pins] Delete error:', error);
            return NextResponse.json(
                { error: 'Failed to delete generated pins', details: error.message },
                { status: 500 }
            );
        }

        // Reset campaign progress
        log('[generated-pins] Resetting campaign progress...');
        await supabase
            .from('campaigns')
            .update({
                generated_pins: 0,
                current_index: 0, // CRITICAL: Reset both counters
                status: 'pending',
                updated_at: new Date().toISOString()
            })
            .eq('id', campaignId);

        log('[generated-pins] Delete complete');
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[generated-pins] DELETE error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
