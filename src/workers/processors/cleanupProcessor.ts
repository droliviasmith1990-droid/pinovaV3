/**
 * Cleanup Processor - BullMQ Worker for Storage Cleanup
 * 
 * Replaces Inngest cleanupStorage function.
 * Runs daily to delete old CSV files from campaigns.
 */

import { createServiceRoleClient } from "@/lib/supabaseServer";

const BUCKET = 'campaign-uploads';
const RETENTION_DAYS = 30;
const BATCH_SIZE = 100;
const MAX_ITERATIONS = 10; // Safety limit to prevent infinite loops

export async function processCleanup(): Promise<{ processed: number; cleaned: number }> {
    console.log('[Cleanup] Starting storage cleanup job...');
    
    const supabase = createServiceRoleClient();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    let totalProcessed = 0;
    let totalCleaned = 0;
    let iteration = 0;

    // Issue #4 Fix: Loop until no more campaigns to clean (with safety limit)
    while (iteration < MAX_ITERATIONS) {
        iteration++;
        
        // Find campaigns older than retention period that still have a CSV file
        const { data: oldCampaigns, error } = await supabase
            .from('campaigns')
            .select('id, csv_url, created_at')
            .not('csv_url', 'is', null)
            .lt('created_at', cutoffDate.toISOString())
            .limit(BATCH_SIZE);

        if (error) {
            console.error('[Cleanup] Failed to fetch old campaigns:', error);
            throw error;
        }

        if (!oldCampaigns || oldCampaigns.length === 0) {
            console.log('[Cleanup] No more old files to cleanup');
            break;
        }

        console.log(`[Cleanup] Iteration ${iteration}: Found ${oldCampaigns.length} old campaigns`);

        // Extract paths and IDs
        const pathsToDelete: string[] = [];
        const idsToDelete: string[] = [];

        for (const campaign of oldCampaigns) {
            if (!campaign.csv_url) continue;

            // Extract path from public URL
            // Format: .../storage/v1/object/public/campaign-uploads/{path}
            const urlParts = campaign.csv_url.split('/campaign-uploads/');
            if (urlParts.length !== 2) {
                console.warn(`[Cleanup] Skipping invalid URL: ${campaign.csv_url}`);
                continue;
            }

            pathsToDelete.push(urlParts[1]);
            idsToDelete.push(campaign.id);
        }

        if (pathsToDelete.length === 0) {
            totalProcessed += oldCampaigns.length;
            continue;
        }

        // Batch delete from Supabase Storage
        const { error: deleteError } = await supabase.storage
            .from(BUCKET)
            .remove(pathsToDelete);

        if (deleteError) {
            console.error('[Cleanup] Failed to delete batch:', deleteError);
            throw deleteError;
        }

        // Update database to remove the reference
        if (idsToDelete.length > 0) {
            const { error: updateError } = await supabase
                .from('campaigns')
                .update({ csv_url: null })
                .in('id', idsToDelete);

            if (updateError) {
                console.error('[Cleanup] Failed to update campaign records:', updateError);
                throw updateError;
            }
        }

        totalProcessed += oldCampaigns.length;
        totalCleaned += idsToDelete.length;
        
        console.log(`[Cleanup] Iteration ${iteration}: Cleaned ${idsToDelete.length} files`);

        // If we got less than batch size, we're done
        if (oldCampaigns.length < BATCH_SIZE) {
            break;
        }
    }

    console.log(`[Cleanup] Completed: ${totalCleaned} files cleaned in ${iteration} iterations`);
    
    return { 
        processed: totalProcessed, 
        cleaned: totalCleaned 
    };
}
