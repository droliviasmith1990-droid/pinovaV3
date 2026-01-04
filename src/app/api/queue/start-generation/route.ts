import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from "@/lib/supabaseServer";
import { addCampaignJob } from '@/lib/queue';
import { setProgress } from '@/lib/redis';

// Vercel Serverless Config
export const maxDuration = 30; // Fast response, just queuing
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            campaignId,
            csvRows,
            startIndex = 0,
        } = body;

        // Validation
        if (!campaignId) {
            return NextResponse.json(
                { success: false, error: 'Missing required field: campaignId' },
                { status: 400 }
            );
        }

        // We can trust the worker to fetch elements/template from DB to save Redis bandwidth
        // But we need to know the total count for progress tracking
        const totalRows = csvRows?.length || 0;
        
        if (totalRows === 0) {
             // If csvRows not provided, maybe we should fetch count? 
             // For now assume client sends rows or at least count.
             // If client doesn't send rows, we might need to fetch campaign to get count.
             // But existing client sends rows.
             return NextResponse.json(
                { success: false, error: 'No rows to process' },
                { status: 400 }
            );
        }

        console.log(`[API/Queue] Received generation request for campaign ${campaignId} (${totalRows} rows)`);

        // 1. Update Campaign Status to 'processing'
        const supabase = createServiceRoleClient();
        const { error: updateError } = await supabase
            .from('campaigns')
            .update({ 
                status: 'processing',
                paused_at: null 
            })
            .eq('id', campaignId);

        if (updateError) {
            console.error('[API/Queue] Failed to update campaign status:', updateError);
            return NextResponse.json(
                { success: false, error: 'Failed to update campaign status' },
                { status: 500 }
            );
        }

        // 2. Initialize Progress in Redis
        await setProgress(campaignId, {
            total: totalRows,
            completed: 0,
            failed: 0,
            status: 'processing',
        });

        // 3. Queue Jobs
        // Chunk size 50 is a good balance for valid progress updates and overhead
        const BATCH_SIZE = 50; 
        const jobs = [];

        for (let i = 0; i < totalRows; i += BATCH_SIZE) {
            // Push lightweight job: Worker will fetch heavy data from DB
            jobs.push(addCampaignJob({
                campaignId,
                startIndex: startIndex + i,
                batchSize: BATCH_SIZE,
                // We do NOT send elements/csvRows to keep Redis lean
            }));
        }

        await Promise.all(jobs);

        console.log(`[API/Queue] Queued ${jobs.length} jobs for ${totalRows} rows`);

        return NextResponse.json({
            success: true,
            message: "Generation queued successfully",
            count: totalRows,
            batches: jobs.length
        });

    } catch (error: any) {
        console.error('[API/Queue] Error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
