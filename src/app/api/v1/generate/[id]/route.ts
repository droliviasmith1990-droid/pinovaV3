import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from "@/lib/supabaseServer";
import { validateApiKey } from '@/lib/db/apiKeys';
import { getProgress } from '@/lib/redis';

export const dynamic = 'force-dynamic';

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

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: campaignId } = await params;

        // 1. Auth Check
        const apiKey = extractApiKey(request);
        if (!apiKey) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        const supabase = createServiceRoleClient();
        const { valid } = await validateApiKey(supabase, apiKey);
        
        if (!valid) {
            return NextResponse.json({ error: 'Invalid API Key' }, { status: 401 });
        }

        // 2. Fetch Progress (Redis First -> FAST)
        const progress = await getProgress(campaignId);
        
        if (progress) {
             const response: any = {
                 success: true,
                 campaign_id: campaignId,
                 status: progress.status,
                 progress: {
                     total: progress.total,
                     completed: progress.completed,
                     failed: progress.failed,
                     percent: progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0
                 }
             };

             // If completed, attempt to fetch results from DB to return to client
             if (progress.status === 'completed') {
                 try {
                     const { data: pins } = await supabase
                        .from('generated_pins')
                        .select('data_row, image_url')
                        .eq('campaign_id', campaignId);
                    
                     if (pins) {
                         response.results = pins.map(p => ({
                             row_index: (p.data_row as any).rowIndex,
                             url: p.image_url
                         }));
                     }
                 } catch (e) {
                     console.error('[API/Poll] Failed to fetch results:', e);
                 }
             }

             return NextResponse.json(response);
        }

        // 3. Fallback: DB Check (If Redis expired or unavailable)
        const { data: campaign, error } = await supabase
            .from('campaigns')
            .select('*') // Need full data
            .eq('id', campaignId)
            .single();

        if (error || !campaign) {
            return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
        }
        
        const response: any = {
            success: true,
            campaign_id: campaignId,
            status: campaign.status,
            progress: {
                total: campaign.total_pins,
                completed: campaign.generated_pins,
                failed: 0,
                percent: campaign.total_pins > 0 ? Math.round((campaign.generated_pins / campaign.total_pins) * 100) : 0
            }
        };

        if (campaign.status === 'completed') {
             const { data: pins } = await supabase
                .from('generated_pins')
                .select('data_row, image_url')
                .eq('campaign_id', campaignId);
            
             if (pins) {
                 response.results = pins.map(p => ({
                     row_index: (p.data_row as any).rowIndex,
                     url: p.image_url
                 }));
             }
        }

        return NextResponse.json(response);

    } catch (error) {
        console.error('[API/Poll] Error:', error);
        return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
    }
}
