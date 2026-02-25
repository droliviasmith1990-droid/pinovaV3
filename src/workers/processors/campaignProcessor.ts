import Papa from 'papaparse';
import { uploadCampaignPin } from '@/lib/s3';
import { Element, ImageElement } from '@/types/editor';
import { setupFabricServerPolyfills } from '@/lib/fabric/server-polyfill';
import { createServiceRoleClient } from "@/lib/supabaseServer";
import { incrementProgress } from "@/lib/redis";
import { CampaignJobData } from '@/lib/queue';
import * as os from 'os';

// OPTIMIZATION: Cache Supabase client at module level
let _supabase: ReturnType<typeof createServiceRoleClient> | null = null;
function getSupabase() {
    if (!_supabase) _supabase = createServiceRoleClient();
    return _supabase;
}

// Debug flag - disable in production for performance
const DEBUG = process.env.NODE_ENV !== 'production' && process.env.WORKER_DEBUG === 'true';

// Campaign data cache interface
interface CachedCampaignData {
    timestamp: number;
    elements: Element[];
    canvasSize: { width: number; height: number };
    backgroundColor: string;
    csvRows: Record<string, string>[];
    fieldMapping: Record<string, string>;
    userId: string; // OPTIMIZATION: Cache userId to avoid extra DB query
}

declare global {
    var campaignCache: Map<string, CachedCampaignData>;
}



export async function processCampaignBatch(jobData: CampaignJobData) {
    const {
        campaignId,
        startIndex = 0,
        batchSize,
    } = jobData;

    let {
        elements,
        canvasSize,
        backgroundColor,
        fieldMapping,
        csvRows,
    } = jobData;

    console.log(`[Worker] Starting batch ${startIndex} for campaign ${campaignId}`);

    // Validation
    if (!campaignId) {
        throw new Error("Missing required field: campaignId");
    }

    const supabase = getSupabase();
    
    // 1. Fetch Campaign and Template Data if missing
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // OPTIMIZATION: InMemory Cache for Campaign Data
    // Reduces DB I/O from 1 fetch/batch to 1 fetch/worker/30min
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    // Simple top-level cache (module scope)
    // Note: This persists as long as the worker process is alive
    if (!global.campaignCache) global.campaignCache = new Map();
    
    // MEMORY SAFETY: Prevent indefinite growth
    // If cache gets too big (e.g. > 20 campaigns), clear it to free memory.
    // This is a crude but effective LRU strategy for this specific use case.
    if (global.campaignCache.size > 20) {
        console.log('[Worker] Cache limit reached, purging in-memory campaign cache');
        global.campaignCache.clear();
    }
    
    const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
    const cached = global.campaignCache.get(campaignId);
    let usedCache = false;

    let userId = '';
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        if (!elements) elements = cached.elements;
        if (!canvasSize) canvasSize = cached.canvasSize;
        if (!backgroundColor) backgroundColor = cached.backgroundColor;
        if (!csvRows) csvRows = cached.csvRows;
        if (!fieldMapping) fieldMapping = cached.fieldMapping;
        userId = cached.userId; // OPTIMIZATION: Get userId from cache
        usedCache = true;
    }

    if ((!elements || !canvasSize || !csvRows || !fieldMapping) && !usedCache) {
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
        let fetchedCsvRows = csvRows || (campaign.csv_data as Record<string, string>[]);
        
        // Download CSV if URL is present (and rows are empty)
        const campaignWithCsv = campaign as { csv_url?: string };
        if ((!fetchedCsvRows || fetchedCsvRows.length === 0) && campaignWithCsv.csv_url) {
            try {
                const csvUrl = campaignWithCsv.csv_url;
                console.log(`[Worker] Downloading CSV from ${csvUrl}`);
                const response = await fetch(csvUrl);
                if (response.ok) {
                    const csvText = await response.text();
                    const parseResult = Papa.parse(csvText, { header: true, skipEmptyLines: true });
                    if (parseResult.data && parseResult.data.length > 0) {
                        fetchedCsvRows = parseResult.data as Record<string, string>[];
                        console.log(`[Worker] Downloaded and parsed ${fetchedCsvRows.length} rows`);
                    }
                } else {
                        console.error(`[Worker] Failed to download CSV: ${response.status} ${response.statusText}`);
                }
            } catch (e) {
                console.error('[Worker] Error fetching/parsing CSV:', e);
            }
        }
        
        csvRows = fetchedCsvRows;

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

        // OPTIMIZATION: Extract userId from the same query (already fetched)
        userId = campaign.user_id;

        // Update Cache (including userId)
        if (elements && canvasSize && csvRows && fieldMapping && userId) {
            global.campaignCache.set(campaignId, {
                timestamp: Date.now(),
                elements,
                canvasSize,
                backgroundColor: backgroundColor || '#ffffff',
                csvRows,
                fieldMapping,
                userId
            });
            if (DEBUG) console.log(`[Worker] Cached campaign data for ${campaignId} (${csvRows.length} rows)`);
        }
    }

    // Apply batch slicing if batchSize is set (Works for both Cached and Fetched data)
    if (batchSize && csvRows && csvRows.length > 0) {
        const safeStartIndex = Math.max(0, Math.min(startIndex, csvRows.length));
        const endIndex = Math.min(safeStartIndex + batchSize, csvRows.length);
        
        // Don't log on every batch to save noise, unless debug
        // console.log(`[Worker] Batching: Slicing rows ${safeStartIndex} to ${endIndex}`);
        csvRows = csvRows.slice(safeStartIndex, endIndex);
    }

    // Re-validate after fetching
    if (!elements || !canvasSize || !csvRows || csvRows.length === 0) {
        throw new Error("Missing required fields (even after DB fetch)");
    }
    
    // Ensure defaults
    if (!fieldMapping) fieldMapping = {};
    if (!backgroundColor) backgroundColor = '#ffffff';
    
    // OPTIMIZATION: Only fetch userId if not already obtained from cache/query
    if (!userId) {
        const { data: campaignUser, error: userError } = await supabase
            .from('campaigns')
            .select('user_id')
            .eq('id', campaignId)
            .single();
            
        if (userError || !campaignUser) {
            throw new Error("User ID not found");
        }
        userId = campaignUser.user_id;
    }

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

    if (DEBUG) console.log(`[Worker] Processing batch of ${csvRows.length} pins for campaign ${campaignId}`);


    const batchResults: { index: number; success: boolean; url?: string; error?: string; rowData: Record<string, string> }[] = [];

    // Debug logging (only when DEBUG is enabled)
    if (DEBUG) {
        console.log(`[Worker] Field Mapping Keys:`, Object.keys(fieldMapping));
        console.log(`[Worker] First Row Keys:`, Object.keys(csvRows[0] || {}));
        const csvHeaders = csvRows.length > 0 ? Object.keys(csvRows[0]) : [];
        elements.forEach((el) => {
            const elWithDynamic = el as { isDynamic?: boolean; dynamicSource?: string; dynamicField?: string; name: string };
            if (elWithDynamic.isDynamic && (elWithDynamic.dynamicSource || elWithDynamic.dynamicField)) {
                const dynamicSource = elWithDynamic.dynamicSource || elWithDynamic.dynamicField;
                const match = csvHeaders.find(h => h === dynamicSource || h.toLowerCase() === dynamicSource!.toLowerCase());
                if (!match) {
                    console.error(`[Worker] MISMATCH: "${elWithDynamic.name}" expects "${dynamicSource}" - NOT FOUND`);
                }
            }
        });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PHASE 1: Create canvas pool
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // OPTIMIZATION: Scale parallel limit based on CPU cores (min 2, max 6)
    const PARALLEL_LIMIT = Math.max(2, Math.min(os.cpus().length, 6)); 
    const canvasPool = new CanvasPool({
        maxSize: PARALLEL_LIMIT,
        defaultWidth: canvasSize!.width,
        defaultHeight: canvasSize!.height
    });
    
    // OPTIMIZATION: Pre-warm canvas pool
    canvasPool.prewarm(PARALLEL_LIMIT, canvasSize!.width, canvasSize!.height);

    try {
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // OPTIMIZATION: Pre-load unique images
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const imageCache = new Map<string, string | Buffer>();
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
                        // OPTIMIZATION: Store RAW Buffer (Skip Base64 encode)
                        const buffer = Buffer.from(arrayBuffer);
                        imageCache.set(url, buffer);
                    }
                } catch (e) {
                    console.warn(`[Worker] Image prefetch failed: ${url}`, e);
                }
            }));
        }
        
        setServerImageCache(imageCache);

        // Render function
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        async function renderSinglePin(rowData: Record<string, string>, _pinIndex: number): Promise<Buffer> {
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
                
                // OPTIMIZATION: Export directly to Buffer (skips Base64 encode/decode)
                // fabric-node / node-canvas extension
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const buffer = (canvas.getElement() as any).toBuffer('image/jpeg', { quality: 0.80 });
                return buffer;
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
                    const url = await uploadCampaignPin(buffer, campaignId, pinIndex);
                    if (!url) throw new Error('Storage upload failed');
                    
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
            
            // Accumulate ONLY local stats, do NOT hit Redis here
            // We will do ONE big update at the end of the batch
        }

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // OPTIMIZATION: Single Redis Update per Batch
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // Previously we updated every 2 pins (25 times per batch).
        // Now we update ONCE per 50 pins. (96% Reduction in Redis commands)
        const totalSuccess = batchResults.filter(r => r.success).length;
        const totalFailed = batchResults.filter(r => !r.success).length;

        try {
            if (totalSuccess > 0) await incrementProgress(campaignId, 'completed', totalSuccess);
            if (totalFailed > 0) await incrementProgress(campaignId, 'failed', totalFailed);
        } catch (redisError) {
             console.warn(`[Worker] Redis progress update failed:`, redisError);
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
