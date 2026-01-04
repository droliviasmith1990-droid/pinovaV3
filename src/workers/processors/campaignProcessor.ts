import Papa from 'papaparse';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { Element, ImageElement } from '@/types/editor';
import { setupFabricServerPolyfills } from '@/lib/fabric/server-polyfill';
import { createServiceRoleClient } from "@/lib/supabaseServer";
import { incrementProgress } from "@/lib/redis";
import { CampaignJobData } from '@/lib/queue';

// Initialize S3 Client for Tebi
const getS3Client = () => {
    // Handle TEBI_ENDPOINT with or without https:// prefix
    const rawEndpoint = process.env.TEBI_ENDPOINT || '';
    const endpoint = rawEndpoint.startsWith('https://') || rawEndpoint.startsWith('http://')
        ? rawEndpoint
        : `https://${rawEndpoint}`;
    
    return new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
            accessKeyId: process.env.TEBI_ACCESS_KEY!,
            secretAccessKey: process.env.TEBI_SECRET_KEY!,
        },
        forcePathStyle: true,
    });
};

// Upload to S3
async function uploadToS3(
    s3Client: S3Client,
    buffer: Buffer,
    campaignId: string,
    pinIndex: number
): Promise<string> {
    const bucket = process.env.TEBI_BUCKET!;
    const key = `campaigns/${campaignId}/pin-${pinIndex}-${uuidv4().substring(0, 8)}.jpg`;

    await s3Client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ContentType: 'image/jpeg',
            ACL: 'public-read',
        })
    );

    // Generate public URL - handle TEBI_ENDPOINT with or without https://
    const rawEndpoint = process.env.TEBI_ENDPOINT || '';
    const baseUrl = rawEndpoint.startsWith('https://') || rawEndpoint.startsWith('http://')
        ? rawEndpoint
        : `https://${rawEndpoint}`;
    return `${baseUrl}/${bucket}/${key}`;
}

export async function processCampaignBatch(jobData: CampaignJobData) {
    let {
        campaignId,
        elements,
        canvasSize,
        backgroundColor,
        fieldMapping,
        csvRows,
        startIndex = 0,
        batchSize,
    } = jobData;

    console.log(`[Worker] Starting batch ${startIndex} for campaign ${campaignId}`);

    // Validation
    if (!campaignId) {
        throw new Error("Missing required field: campaignId");
    }

    const supabase = createServiceRoleClient();
    
    // 1. Fetch Campaign and Template Data if missing
    if (!elements || !canvasSize || !csvRows || !fieldMapping) {
            const { data: campaign, error: campaignError } = await supabase
            .from('campaigns')
            .select(`
                user_id,
                template_id,
                csv_data,
                csv_url,
                field_mapping,
                templates (
                    elements,
                    canvas_size,
                    background_color
                )
            `)
            .eq('id', campaignId)
            .single();

        if (campaignError || !campaign) {
            throw new Error(`Campaign not found: ${campaignError?.message}`);
        }

        // Fill in missing data from DB
        if (!csvRows) csvRows = campaign.csv_data as Record<string, string>[];
        
        // Download CSV if URL is present (and rows are empty)
        if ((!csvRows || csvRows.length === 0) && (campaign as any).csv_url) {
            try {
                const csvUrl = (campaign as any).csv_url;
                console.log(`[Worker] Downloading CSV from ${csvUrl}`);
                const response = await fetch(csvUrl);
                if (response.ok) {
                    const csvText = await response.text();
                    const parseResult = Papa.parse(csvText, { header: true, skipEmptyLines: true });
                    if (parseResult.data && parseResult.data.length > 0) {
                        csvRows = parseResult.data as Record<string, string>[];
                        console.log(`[Worker] Downloaded and parsed ${csvRows.length} rows`);
                    }
                } else {
                        console.error(`[Worker] Failed to download CSV: ${response.status} ${response.statusText}`);
                }
            } catch (e) {
                console.error('[Worker] Error fetching/parsing CSV:', e);
            }
        }

        // Apply batch slicing if batchSize is set
        if (batchSize && csvRows && csvRows.length > 0) {
            const safeStartIndex = Math.max(0, Math.min(startIndex, csvRows.length));
            const endIndex = Math.min(safeStartIndex + batchSize, csvRows.length);
            
            console.log(`[Worker] Batching: Slicing rows ${safeStartIndex} to ${endIndex} (Total: ${csvRows.length})`);
            csvRows = csvRows.slice(safeStartIndex, endIndex);
        }

        if (!fieldMapping) fieldMapping = campaign.field_mapping as Record<string, string>;
        
        // Handle join structure
        const template = campaign.templates as unknown as { elements: Element[], canvas_size: { width: number, height: number }, background_color: string };
        
        if (template) {
            if (!elements) elements = template.elements;
            if (!canvasSize) canvasSize = template.canvas_size;
            if (!backgroundColor) backgroundColor = template.background_color;
        } else {
                throw new Error("Template linked to campaign not found");
        }
    }

    // Re-validate after fetching
    if (!elements || !canvasSize || !csvRows || csvRows.length === 0) {
        throw new Error("Missing required fields (even after DB fetch)");
    }
    
    // Ensure defaults
    if (!fieldMapping) fieldMapping = {};
    if (!backgroundColor) backgroundColor = '#ffffff';
    
    // Fetch userId if needed
    let userId = '';
    const { data: campaignUser, error: userError } = await supabase
        .from('campaigns')
        .select('user_id')
        .eq('id', campaignId)
        .single();
        
    if (userError || !campaignUser) {
        throw new Error("User ID not found");
    }
    userId = campaignUser.user_id;

    // 2. Perform Rendering
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 1: Setup polyfills BEFORE importing fabric
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    setupFabricServerPolyfills();

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 2: Dynamic import of fabric-dependent modules
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const { renderTemplate, setServerImageCache, clearServerImageCache, getDynamicImageUrl } = await import('@/lib/fabric/engine');
    const { prepareElementsForServerRendering } = await import('@/lib/fabric/serverEngine');
    const { CanvasPool } = await import('@/lib/canvas/CanvasPool');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // FONT FIX
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    const preparedElements = await prepareElementsForServerRendering(elements, supabaseUrl, supabaseKey);

    console.log(`[Worker] Processing batch of ${csvRows.length} pins for campaign ${campaignId}`);

    const s3Client = getS3Client();
    const batchResults: any[] = [];

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PHASE 1: Create canvas pool
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // VPS has 4 cores, we can be aggressive but safe
    const PARALLEL_LIMIT = 4; // Use all 4 cores effectively
    const canvasPool = new CanvasPool({
        maxSize: PARALLEL_LIMIT,
        defaultWidth: canvasSize!.width,
        defaultHeight: canvasSize!.height
    });

    try {
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // OPTIMIZATION: Pre-load unique images
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const imageCache = new Map<string, string>();
        const imageElements = preparedElements.filter(el => el.type === 'image' && el.visible);
        const uniqueUrls = new Set<string>();
        
        for (const el of imageElements) {
            const imgEl = el as ImageElement;
            
            if (imgEl.isDynamic) {
                for (const row of csvRows!) {
                    const url = getDynamicImageUrl(imgEl, row, fieldMapping!);
                    if (url) uniqueUrls.add(url);
                }
            } else {
                const url = getDynamicImageUrl(imgEl, {}, {});
                if (url) uniqueUrls.add(url);
            }
        }
        
        // Pre-fetch images
        const uniqueUrlArray = Array.from(uniqueUrls);
        const IMAGE_CONCURRENCY = 20;
        
        for (let i = 0; i < uniqueUrlArray.length; i += IMAGE_CONCURRENCY) {
            const chunk = uniqueUrlArray.slice(i, i + IMAGE_CONCURRENCY);
            await Promise.all(chunk.map(async (url) => {
                try {
                    let fetchUrl = url;
                    if (url.startsWith('/api/proxy-image')) {
                        const urlParams = new URLSearchParams(url.split('?')[1] || '');
                        const originalUrl = urlParams.get('url');
                        if (originalUrl) fetchUrl = decodeURIComponent(originalUrl);
                    }
                    
                    const response = await fetch(fetchUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Pinterest Worker; Linux x64)',
                            'Accept': 'image/*',
                        },
                    });
                    
                    if (response.ok) {
                        const arrayBuffer = await response.arrayBuffer();
                        const base64 = Buffer.from(arrayBuffer).toString('base64');
                        const contentType = response.headers.get('content-type') || 'image/png';
                        imageCache.set(url, `data:${contentType};base64,${base64}`);
                    }
                } catch (e) {
                    console.warn(`[Worker] Image prefetch failed: ${url}`, e);
                }
            }));
        }
        
        setServerImageCache(imageCache);

        // Render function
        async function renderSinglePin(rowData: Record<string, string>, pinIndex: number): Promise<Buffer> {
            const canvas = canvasPool.acquire();
            try {
                canvas.clear();
                
                const config = {
                    width: canvasSize!.width,
                    height: canvasSize!.height,
                    backgroundColor,
                    interactive: false,
                };

                await renderTemplate(canvas, preparedElements, config, rowData, fieldMapping);
                
                const dataUrl = canvas.toDataURL({
                    format: 'jpeg',
                    quality: 0.80, 
                    multiplier: 1,
                });

                const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
                return Buffer.from(base64Data, 'base64');
            } finally {
                canvasPool.release(canvas);
            }
        }

        // Process pins
        for (let i = 0; i < csvRows.length; i += PARALLEL_LIMIT) {
            const chunk = csvRows.slice(i, i + PARALLEL_LIMIT);
            const chunkPromises = chunk.map(async (rowData, chunkIndex) => {
                const pinIndex = startIndex + i + chunkIndex;
                try {
                    const buffer = await renderSinglePin(rowData, pinIndex);
                    const url = await uploadToS3(s3Client, buffer, campaignId, pinIndex);
                    
                    return {
                        index: pinIndex,
                        success: true,
                        url,
                        rowData,
                    };
                } catch (error) {
                    console.error(`[Worker] Pin ${pinIndex} failed:`, error);
                    return {
                        index: pinIndex,
                        success: false,
                        error: error instanceof Error ? error.message : 'Unknown error',
                        rowData,
                    };
                }
            });

            const chunkResults = await Promise.all(chunkPromises);
            batchResults.push(...chunkResults);
            
            // Update real-time progress in Redis
            try {
                const successCount = chunkResults.filter(r => r.success).length;
                const failCount = chunkResults.filter(r => !r.success).length;
                if (successCount > 0) await incrementProgress(campaignId, 'completed', successCount);
                if (failCount > 0) await incrementProgress(campaignId, 'failed', failCount);
            } catch (redisError) {
                console.warn(`[Worker] Redis progress update failed, continuing:`, redisError);
            }
        }
    } finally {
        canvasPool.cleanup();
        clearServerImageCache();
    }

    console.log(`[Worker] Batch complete: ${batchResults.length} pins processed`);

    // 3. Save Results to Supabase
    const successResults = batchResults.filter(r => r.success);
    
    // Insert generated pins
    if (successResults.length > 0) {
            const { error } = await supabase.from('generated_pins').insert(
            successResults.map(r => ({
                campaign_id: campaignId,
                user_id: userId,
                data_row: { ...r.rowData, rowIndex: r.index },
                image_url: r.url,
                status: 'generated'
            }))
        );
        
        if (error) throw error;
    }

    // Update campaign stats
    if (successResults.length > 0) {
        const { error: rpcError } = await supabase.rpc(
            'increment_campaign_pins',
            { 
                campaign_uuid: campaignId, 
                increment_by: successResults.length 
            }
        );
        
        if (rpcError) {
            // Fallback update
            const { data: campaignState } = await supabase
                .from('campaigns')
                .select('generated_pins, total_pins')
                .eq('id', campaignId)
                .single();
            
            if (campaignState) {
                const newTotal = (campaignState.generated_pins || 0) + successResults.length;
                const isComplete = newTotal >= campaignState.total_pins;
                
                const updateData: Record<string, unknown> = {
                    generated_pins: newTotal,
                    updated_at: new Date().toISOString()
                };
                
                if (isComplete) {
                    updateData.status = 'completed';
                    updateData.completed_at = new Date().toISOString();
                }
                
                await supabase
                    .from('campaigns')
                    .update(updateData)
                    .eq('id', campaignId);
            }
        }
    }

    return { success: true, count: batchResults.length };
}
