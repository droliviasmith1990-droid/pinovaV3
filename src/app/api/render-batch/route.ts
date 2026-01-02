import { NextRequest, NextResponse } from 'next/server';
import { inngest } from "@/inngest/client";
import { createServiceRoleClient } from "@/lib/supabaseServer";
import { Element } from '@/types/editor';
import { checkRateLimit, setProgress } from '@/lib/redis';

// Vercel Serverless Config
export const maxDuration = 10; // Fast response
export const dynamic = 'force-dynamic';

interface RenderBatchRequest {
    campaignId: string;
    elements: Element[];
    canvasSize: { width: number; height: number };
    backgroundColor: string;
    fieldMapping?: Record<string, string>;
    csvRows: Record<string, string>[];
    startIndex?: number;
}

export async function POST(req: NextRequest) {
    try {
        const body: RenderBatchRequest = await req.json();
        const {
            campaignId,
            elements,
            canvasSize,
            backgroundColor,
            fieldMapping = {},
            csvRows,
            startIndex = 0,
        } = body;

        // Validation
        if (!campaignId || !elements || !canvasSize || !csvRows || csvRows.length === 0) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields' },
                { status: 400 }
            );
        }

        if (typeof campaignId !== 'string') {
             console.error(`[API] Invalid campaignId type: ${typeof campaignId}`);
             return NextResponse.json(
                { success: false, error: 'Invalid campaignId: must be a string' },
                { status: 400 }
            );
        }

        // Rate limiting: 100 batch requests per hour per campaign
        const allowed = await checkRateLimit(`render:${campaignId}`, 100, 3600);
        if (!allowed) {
            console.warn(`[API] Rate limit exceeded for campaign ${campaignId}`);
            return NextResponse.json(
                { success: false, error: 'Rate limit exceeded. Please wait before generating more pins.' },
                { status: 429 }
            );
        }

        console.log(`[API] Received batch render request for campaign ${campaignId} (${csvRows.length} rows)`);

        // Debug: Check environment variables (do not log keys)
        if (!process.env.NEXT_PUBLIC_SUPABASE_URL) console.error('[API] Missing NEXT_PUBLIC_SUPABASE_URL');
        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) console.error('[API] Missing SUPABASE_SERVICE_ROLE_KEY');
        if (!process.env.INNGEST_EVENT_KEY) console.warn('[API] Missing INNGEST_EVENT_KEY (required for production)');

        // 1. Update Campaign Status to 'processing'
        console.log('[API] Updating campaign status...');
        const supabase = createServiceRoleClient();
        const { error: updateError } = await supabase
            .from('campaigns')
            .update({ 
                status: 'processing',
                paused_at: null // Clear any pause state
            })
            .eq('id', campaignId);

        if (updateError) {
            console.error('[API] Failed to update campaign status:', updateError);
            return NextResponse.json(
                { success: false, error: 'Failed to update campaign status: ' + updateError.message },
                { status: 500 }
            );
        }

        // 2. Send Events to Inngest (Batched)
        console.log('[API] Sending batched events to Inngest...');
        const BATCH_SIZE = 25; // Adjusted to 25 to strictly avoid 60s Vercel timeouts (est. 15-20s exec time)
        const events = [];
        const totalRows = csvRows.length;

        for (let i = 0; i < totalRows; i += BATCH_SIZE) {
            // Explicitly construct payload for each batch
            const eventPayload = {
                campaignId: typeof campaignId === 'string' ? campaignId : String(campaignId),
                startIndex: startIndex + i,
                batchSize: BATCH_SIZE
            };
            
            events.push({
                name: "campaign/render.requested",
                data: eventPayload,
            });
        }

        console.log(`[API] Created ${events.length} batches for ${totalRows} rows`);

        try {
            // Initialize progress tracking in Redis
            await setProgress(campaignId, {
                total: totalRows,
                completed: 0,
                failed: 0,
                status: 'processing',
            });
            
            // Send all batch events at once
            await inngest.send(events);
        } catch (inngestError: unknown) {
            console.error('[API] Inngest send failed:', inngestError);
             const errorMessage = inngestError instanceof Error ? inngestError.message : 'Unknown Inngest error';
             // Revert campaign status if Inngest fails
             await supabase.from('campaigns').update({ status: 'failed' }).eq('id', campaignId);
             
             return NextResponse.json(
                { success: false, error: `Failed to trigger background job: ${errorMessage}` },
                { status: 500 }
            );
        }

        console.log('[API] Batch rendering started successfully');

        // 3. Return Immediate Success
        return NextResponse.json({
            success: true,
            message: "Batch rendering started in background",
            count: csvRows.length
        });

    } catch (error: unknown) {
        console.error('[API] Error starting batch render:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
    }
}