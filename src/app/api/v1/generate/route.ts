import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabaseServer';
import { validateApiKey } from '@/lib/db/apiKeys';
import { getTemplateByShortId } from '@/lib/db/templates';
import { addCampaignJob } from '@/lib/queue';
import { setProgress } from '@/lib/redis';

// Vercel Serverless Config
export const maxDuration = 30; // Fast response
export const dynamic = 'force-dynamic';

// Error codes
type ErrorCode = 'INVALID_API_KEY' | 'TEMPLATE_NOT_FOUND' | 'VALIDATION_ERROR' | 'RATE_LIMIT' | 'SERVER_ERROR';

// Request/Response interfaces
interface GenerateRequest {
    template_id: string;
    rows: Record<string, string>[];
    field_mapping?: Record<string, string>;
    multiplier?: number;
    campaign_name?: string; // Optional name for the campaign
}

interface AsyncGenerateResponse {
    success: true;
    campaign_id: string;
    status: 'pending';
    message: string;
    status_url: string;
    meta: {
        total_rows: number;
        estimated_time_seconds: number;
    };
}

interface ErrorResponse {
    success: false;
    error: string;
    code: ErrorCode;
}

/**
 * Extract API key from request headers
 */
function extractApiKey(request: NextRequest): string | null {
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    const apiKeyHeader = request.headers.get('X-API-Key');
    if (apiKeyHeader) {
        return apiKeyHeader;
    }
    return null;
}

/**
 * Create error response helper
 */
function errorResponse(error: string, code: ErrorCode, status: number): NextResponse<ErrorResponse> {
    return NextResponse.json({ success: false, error, code }, { status });
}

/**
 * POST /api/v1/generate
 * Async Trigger: Accepts JSON, creates Campaign, Queues Job, Returns ID.
 */
export async function POST(request: NextRequest): Promise<NextResponse<AsyncGenerateResponse | ErrorResponse>> {
    try {
        // 1. Extract and validate API key
        const apiKey = extractApiKey(request);
        if (!apiKey) {
            return errorResponse(
                'Missing API key. Provide via Authorization: Bearer <key> or X-API-Key header.',
                'INVALID_API_KEY',
                401
            );
        }

        // 2. Validate API key and get user ID
        const supabase = createServiceRoleClient();
        const { valid, userId, error: authError } = await validateApiKey(supabase, apiKey);

        if (!valid || !userId) {
            return errorResponse(
                authError || 'Invalid API key',
                'INVALID_API_KEY',
                401
            );
        }

        // 3. Parse and validate request body
        let body: GenerateRequest;
        try {
            body = await request.json();
        } catch {
            return errorResponse('Invalid JSON body', 'VALIDATION_ERROR', 400);
        }

        const { template_id, rows, field_mapping = {}, campaign_name } = body;

        // Validate required fields
        if (!template_id) {
            return errorResponse('template_id is required', 'VALIDATION_ERROR', 400);
        }

        if (!rows || !Array.isArray(rows) || rows.length === 0) {
            return errorResponse('rows must be a non-empty array', 'VALIDATION_ERROR', 400);
        }

        // 4. Fetch template by short_id
        const template = await getTemplateByShortId(template_id, supabase);
        if (!template) {
            return errorResponse(
                `Template not found: ${template_id}`,
                'TEMPLATE_NOT_FOUND',
                404
            );
        }

        // 5. Create Campaign in DB
        // We store the CSV data immediately so the worker can fetch it
        // This decouples the large payload from the queue logic
        const campaignName = campaign_name || `API Import - ${new Date().toLocaleString()}`;
        
        const { data: campaign, error: createError } = await supabase
            .from('campaigns')
            .insert({
                user_id: userId,
                template_id: template.id,
                name: campaignName,
                status: 'pending', // Initial status
                total_pins: rows.length,
                generated_pins: 0,
                csv_data: rows, // Store full data in DB (JSONB)
                field_mapping: field_mapping,
            })
            .select('id')
            .single();

        if (createError || !campaign) {
            console.error('[api/v1/generate] Failed to create campaign:', createError);
            return errorResponse('Failed to create campaign record', 'SERVER_ERROR', 500);
        }

        const campaignId = campaign.id;

        // 6. Initialize Redis Progress
        await setProgress(campaignId, {
            total: rows.length,
            completed: 0,
            failed: 0,
            status: 'pending',
        });

        // 7. Queue Jobs (Batching)
        const BATCH_SIZE = 50;
        const jobs = [];

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            // Push lightweight job: Worker will fetch heavy data from DB (via campaignId)
            jobs.push(addCampaignJob({
                campaignId,
                startIndex: i,
                batchSize: BATCH_SIZE,
                // Do NOT send csvRows here - worker fetches from DB
            }));
        }

        await Promise.all(jobs);

        // Update status to 'processing' (or 'queued')
        await supabase
            .from('campaigns')
            .update({ status: 'processing' }) // Mark as processing immediately or leave as queueing? 'processing' is safer for UI
            .eq('id', campaignId);
            
        // Also update Redis status
        await setProgress(campaignId, {
            total: rows.length,
            completed: 0,
            failed: 0,
            status: 'processing',
        });

        console.log(`[API/Async] Queued campaign ${campaignId} with ${rows.length} rows (${jobs.length} batches)`);

        // 8. Return Async Response
        // Estimate: 0.5s per pin / Concurrency 4 = ~0.125s per pin? Conservative: 1s per pin / 4 workers
        // Let's say 400 pins/min = ~6.6 pins/sec.
        const estimatedSeconds = Math.ceil(rows.length / 5); // Very rough estimate

        const host = request.headers.get('host') || 'localhost:3000';
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const statusUrl = `${protocol}://${host}/api/v1/generate/${campaignId}`;

        return NextResponse.json({
            success: true,
            campaign_id: campaignId,
            status: 'pending',
            message: 'Campaign created and processing started.',
            status_url: statusUrl,
            meta: {
                total_rows: rows.length,
                estimated_time_seconds: estimatedSeconds,
            },
        });

    } catch (error) {
        console.error('[api/v1/generate] Unexpected error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Internal server error';
        return errorResponse(errorMessage, 'SERVER_ERROR', 500);
    }
}

/**
 * GET /api/v1/generate - Return API documentation
 */
export async function GET(): Promise<NextResponse> {
    return NextResponse.json({
        endpoint: '/api/v1/generate',
        method: 'POST',
        description: 'Asynchronous generation of Pinterest pins. Returns a campaign ID to poll for status.',
        authentication: 'Bearer token or X-API-Key header',
        request_body: {
            template_id: 'string (required) - Template short ID',
            rows: 'array (required) - Array of data objects',
            field_mapping: 'object (optional) - Maps template fields to row columns',
            campaign_name: 'string (optional) - Name for the campaign',
        },
        response: {
            success: true,
            campaign_id: 'uuid',
            status: 'pending',
            status_url: 'https://.../api/v1/generate/{id}',
        },
    });
}
