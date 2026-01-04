'use client';

// Debug logging - only in development
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => DEBUG && console.log('[HybridController]', ...args);

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Play, RotateCcw, RefreshCw, Server, Monitor } from 'lucide-react';
import { toast } from 'sonner';
import { throttle } from 'lodash';
// fabric is used within the pool, not directly here
import { useCampaignGeneration } from '@/stores/generationStore';
import { renderTemplate, exportToBlob, FieldMapping } from '@/lib/fabric/engine';
import { Element, CanvasSize } from '@/types/editor';
import { PinCardData } from './PinCard';
import { getCanvasPool } from '@/lib/canvas/CanvasPool';
import { getImageCache, extractImageUrls } from '@/lib/canvas/ImagePreloadCache';
import { EnhancedProgressTracker } from './EnhancedProgressTracker';
import { calculateProgressMetrics, formatDuration } from '@/hooks/useProgressMetrics';
import { TemplateSnapshot, DistributionMode, CampaignStatistics } from '@/types/database.types';
import { 
    getTemplateForRow, 
    initializeDistributionSession, 
    DistributionContext,
} from '@/lib/campaigns/distributionEngine';
import { supabase } from '@/lib/supabase';

// ============================================
// Types
// ============================================
export interface GenerationSettings {
    batchSize: number;
    quality: 'draft' | 'normal' | 'high' | 'ultra';
    pauseEnabled: boolean;
    renderMode: 'auto' | 'client' | 'server';
}

export interface GenerationProgress {
    current: number;
    total: number;
    percentage: number;
    status: 'idle' | 'generating' | 'paused' | 'completed' | 'error';
    errors: Array<{ rowIndex: number; error: string }>;
    
    // Timing metrics for ETA calculation
    startTime: number | null;
    elapsedTime: number;
    pausedDuration: number;
    
    // Speed and ETA
    currentSpeed: number;
    estimatedTimeRemaining: number;
    
    // Current operation
    currentPinTitle: string;
    currentPinIndex: number;
}

// Quality to multiplier mapping
const QUALITY_MAP: Record<GenerationSettings['quality'], number> = {
    draft: 1,
    normal: 2,
    high: 3,
    ultra: 4,
};

// Default settings
export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
    batchSize: 10,
    quality: 'draft', // Changed to 'draft' (1x) as requested
    pauseEnabled: true,
    renderMode: 'auto',
};

// ============================================
// Props Interface
// ============================================
interface GenerationControllerProps {
    campaignId: string;
    userId: string;

    // Single template mode (backward compatible)
    templateElements: Element[];
    canvasSize: CanvasSize;
    backgroundColor: string;
    
    // Multi-template mode (new)
    templateSnapshots?: TemplateSnapshot[];
    distributionMode?: DistributionMode;
    onStatisticsUpdate?: (stats: CampaignStatistics) => void;
    
    csvData: Record<string, string>[];
    fieldMapping: Record<string, string>;
    initialSettings?: GenerationSettings;
    initialProgress?: number;
    initialStatus?: 'pending' | 'processing' | 'paused' | 'completed' | 'failed';
    generatedCount: number;
    onPinGenerated: (pin: PinCardData) => void;
    onProgressUpdate: (progress: GenerationProgress) => void;
    onStatusChange: (status: string) => void;
}

// ============================================
// Component
// ============================================
export function GenerationController({
    campaignId,
    userId,

    templateElements,
    canvasSize,
    backgroundColor,
    
    // Multi-template props (new)
    templateSnapshots,
    distributionMode = 'sequential',
    onStatisticsUpdate,
    
    csvData,
    fieldMapping,
    initialSettings = DEFAULT_GENERATION_SETTINGS,
    initialProgress = 0,
    initialStatus = 'pending',
    generatedCount,
    onPinGenerated,
    onProgressUpdate,
    onStatusChange,
}: GenerationControllerProps) {
    // ============================================
    // Multi-Template Distribution Setup
    // ============================================
    const isMultiTemplateMode = Boolean(templateSnapshots && templateSnapshots.length > 1);
    
    // Distribution context for template selection
    const distributionContextRef = useRef<DistributionContext | null>(null);
    
    // Statistics tracking per template
    const templateStatsRef = useRef<Record<string, { generated: number; failed: number }>>({});
    
    // Initialize distribution session and stats on mount/change
    useEffect(() => {
        if (isMultiTemplateMode && templateSnapshots) {
            initializeDistributionSession();
            distributionContextRef.current = {
                templates: templateSnapshots,
                mode: distributionMode,
                totalRows: csvData.length,
            };
            // Initialize stats for each template
            templateStatsRef.current = {};
            templateSnapshots.forEach(t => {
                templateStatsRef.current[t.id] = { generated: 0, failed: 0 };
            });
        }
    }, [isMultiTemplateMode, templateSnapshots, distributionMode, csvData.length]);
    
    // Helper: Get template data for a specific row
    const getTemplateForRowIndex = useCallback((rowIndex: number, rowData: Record<string, string>) => {
        if (!isMultiTemplateMode || !distributionContextRef.current) {
            // Single template mode - use props directly
            return {
                elements: templateElements,
                canvasSize,
                backgroundColor,
                templateId: null,
            };
        }
        
        // Multi-template mode - use distribution engine
        const result = getTemplateForRow(distributionContextRef.current, { rowIndex, csvRow: rowData });
        const template = result.template;
        
        if (result.warning) {
            console.warn(`[Distribution] Row ${rowIndex}: ${result.warning}`);
        }
        
        return {
            elements: template.elements,
            canvasSize: template.canvas_size,
            backgroundColor: template.background_color,
            templateId: template.id,
        };
    }, [isMultiTemplateMode, templateElements, canvasSize, backgroundColor]);
    
    // Helper: Update statistics after pin generation
    const updateTemplateStats = useCallback((templateId: string | null, success: boolean) => {
        if (!templateId || !isMultiTemplateMode) return;
        
        if (!templateStatsRef.current[templateId]) {
            templateStatsRef.current[templateId] = { generated: 0, failed: 0 };
        }
        
        if (success) {
            templateStatsRef.current[templateId].generated++;
        } else {
            templateStatsRef.current[templateId].failed++;
        }
        
        // Notify parent of stats update using CampaignStatistics format
        if (onStatisticsUpdate) {
            // Convert to template_distribution format: template_id -> generated count
            const templateDistribution: Record<string, number> = {};
            Object.entries(templateStatsRef.current).forEach(([id, stats]) => {
                templateDistribution[id] = stats.generated;
            });
            
            onStatisticsUpdate({
                template_distribution: templateDistribution,
            });
        }
    }, [isMultiTemplateMode, onStatisticsUpdate]);


    // Initialize settings from localStorage if available, falling back to initialSettings
    const [settings, setSettings] = useState<GenerationSettings>(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem('pin-generator-settings');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    // Merge with defaults to ensure all fields exist
                    return { ...DEFAULT_GENERATION_SETTINGS, ...parsed };

                }
            } catch (error) {
                console.warn('Failed to load settings from localStorage:', error);
            }
        }
        return initialSettings;
    });
    
    // Sync internal settings with initialSettings prop changes
    // This allows the parent component to control settings updates
    useEffect(() => {
        if (initialSettings) {
            setSettings(prev => ({ ...prev, ...initialSettings }));
        }
    }, [initialSettings]);

    const [status, setStatus] = useState(initialStatus);
    const [progress, setProgress] = useState<GenerationProgress>(() => {
        const actualProgress = generatedCount > 0 ? generatedCount : initialProgress;
        return {
            current: actualProgress,
            total: csvData.length,
            percentage: Math.round((actualProgress / csvData.length) * 100),
            status: 'idle',
            errors: [],
            // Timing fields
            startTime: null,
            elapsedTime: 0,
            pausedDuration: 0,
            currentSpeed: 0,
            estimatedTimeRemaining: 0,
            currentPinTitle: '',
            currentPinIndex: 0,
        };
    });

    const [isPausing, setIsPausing] = useState(false);
    const [activeMode, setActiveMode] = useState<'client' | 'server' | null>(null);
    
    // Render mode selection with localStorage persistence
    // Server mode uses Vercel functions with DOM polyfills for Fabric.js
    // Default to 'server' for optimal bulk generation performance
    const [renderMode, setRenderModeState] = useState<'client' | 'server'>('server');
    
    // Load renderMode from localStorage on mount
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('pinGeneratorRenderMode');
            if (saved === 'client' || saved === 'server') {
                setRenderModeState(saved);
            }
        }
    }, []);
    
    // Save renderMode to localStorage when changed
    const setRenderMode = (mode: 'client' | 'server') => {
        setRenderModeState(mode);
        if (typeof window !== 'undefined') {
            localStorage.setItem('pinGeneratorRenderMode', mode);
        }
    };

    // Generation resume store integration
    const { state: savedState, canResume, save: saveProgress, clear: clearProgress, isStale } = useCampaignGeneration(campaignId);

    // Refs
    const shouldPauseRef = useRef(false);
    const isMountedRef = useRef(true);
    
    // Canvas pool for reuse - size matches CLIENT_PARALLEL_LIMIT + buffer
    const canvasPoolRef = useRef(getCanvasPool({ maxSize: 6 }));
    
    // Timing refs for ETA calculation
    const startTimeRef = useRef<number | null>(null);
    const pausedAtRef = useRef<number | null>(null);
    const totalPausedDurationRef = useRef<number>(0);

    const statusRef = useRef(status);
    const campaignIdRef = useRef(campaignId);

    useEffect(() => {
        statusRef.current = status;
        campaignIdRef.current = campaignId;
    }, [status, campaignId]);

    // Throttled progress saver
    const throttledSaveProgressRef = useRef(
        throttle((data: Parameters<typeof saveProgress>[0]) => {
            saveProgress(data);
        }, 2000, { leading: true, trailing: true })
    );

    // Debug: Log resume state on mount
    useEffect(() => {
        log('Resume state:', { campaignId, savedState, canResume, isStale, status });
    }, [campaignId, savedState, canResume, isStale, status]);

    // Sync status based on actual progress
    useEffect(() => {
        // 🚀 FIX: If not processing, respect valid generatedCount from DB even if 0
        // This fixes the issue where DB reset (0) was ignored because progress.current (84) was used fallback
        if (status !== 'processing' && typeof generatedCount === 'number') {
            if (generatedCount === 0 && progress.current > 0) {
                // Detected reset
                log('[Sync] Detected reset from DB. Resetting local state.');
                clearProgress();
                setStatus('pending');
                onStatusChange('pending');
                setProgress(prev => ({
                    ...prev,
                    current: 0,
                    total: csvData.length,
                    percentage: 0,
                    status: 'idle',
                    // Reset timing
                    startTime: null,
                    elapsedTime: 0,
                    pausedDuration: 0,
                    currentSpeed: 0,
                    estimatedTimeRemaining: 0
                }));
                return;
            }
        }

        const actualCount = generatedCount || progress.current;
        const total = csvData.length;
        const isComplete = actualCount >= total;

        if (isComplete && status !== 'completed' && status !== 'failed') {
            setStatus('completed');
            onStatusChange('completed');
            clearProgress();
        }

        // Just purely for cleanup of stale resume state
        if (savedState && actualCount > savedState.lastCompletedIndex + 1) {
             // If we have advanced beyond saved state, clear it
             // clearProgress(); // Don't aggressive clear, let user clear or completion clear
        }
    }, [status, generatedCount, progress.current, csvData.length, onStatusChange, savedState, clearProgress]);

    // Cleanup on unmount / unload
    useEffect(() => {
        isMountedRef.current = true;

        const handleUnload = () => {
            const currentStatus = statusRef.current;
            const currentCampaignId = campaignIdRef.current;

            if (currentStatus === 'processing' && renderMode === 'client') {
                // Use text/plain to avoid CORS preflight options check which can fail on unload
                // The API route is updated to parse this text as JSON
                const blob = new Blob(
                    [JSON.stringify({ status: 'paused', campaignId: currentCampaignId })], 
                    { type: 'text/plain' }
                );
                
                if (navigator.sendBeacon) {
                    navigator.sendBeacon('/api/campaigns/update-status-beacon', blob);
                } else {
                    // Fallback using fetch with keepalive 
                    // Note: sending to the beacon endpoint is fine as it handles the logic
                    fetch('/api/campaigns/update-status-beacon', { 
                        method: 'POST',
                        body: blob,
                        keepalive: true,
                        headers: { 'Content-Type': 'text/plain' }
                    }).catch(console.error);
                }
            }
        };

        window.addEventListener('beforeunload', handleUnload);
        
        // Reliability Fix: Also trigger on visibility change (mobile/tab switch)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                handleUnload();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            isMountedRef.current = false;
            throttledSaveProgressRef.current.cancel();
            window.removeEventListener('beforeunload', handleUnload);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            
            // Trigger on component unmount
            handleUnload();
        };
    }, [renderMode]); // Stable dependency, status tracked via ref

    // ============================================
    // Realtime Subscription for Server Mode
    // ============================================
    useEffect(() => {
        if (renderMode !== 'server' || status !== 'processing') return;

        console.log('[GenerationController] Subscribing to realtime updates for campaign', campaignId);

        const channel = supabase
            .channel(`campaign-generation-${campaignId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'generated_pins',
                    filter: `campaign_id=eq.${campaignId}`,
                },
                (payload) => {
                    const newPin = payload.new as any; // eslint-disable-line @typescript-eslint/no-explicit-any
                    
                    const rowIndex = newPin.data_row?.rowIndex ?? -1;
                    
                    // Only process if we have a valid index
                    if (rowIndex >= 0) {
                        onPinGenerated({
                            id: newPin.id,
                            rowIndex: rowIndex,
                            imageUrl: newPin.image_url,
                            status: 'completed',
                            csvData: newPin.data_row,
                        });

                        // Update local progress state
                        setProgress(prev => {
                            const newCurrent = prev.current + 1;
                             const metrics = calculateProgressMetrics({
                                completed: newCurrent,
                                total: csvData.length,
                                startTime: startTimeRef.current,
                                pausedDuration: totalPausedDurationRef.current,
                                isPaused: false,
                                currentTime: Date.now(),
                            });
                            
                            const newProg = {
                                ...prev,
                                current: newCurrent,
                                percentage: Math.round((newCurrent / csvData.length) * 100),
                                elapsedTime: metrics.elapsedTimeMs,
                                currentSpeed: metrics.pinsPerSecond,
                                estimatedTimeRemaining: metrics.etaSeconds * 1000,
                                currentPinIndex: newCurrent,
                                currentPinTitle: newPin.data_row?.title || newPin.data_row?.name || `Row ${rowIndex + 1}`
                            };
                            
                            // Call prop update
                            onProgressUpdate(newProg);
                            
                            return newProg;
                        });
                    }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'campaigns',
                    filter: `id=eq.${campaignId}`,
                },
                (payload) => {
                    const updatedCampaign = payload.new as any; // eslint-disable-line @typescript-eslint/no-explicit-any
                    if (updatedCampaign.status === 'completed') {
                         setStatus('completed');
                         onStatusChange('completed');
                         toast.success('Generation completed!');
                    } else if (updatedCampaign.status === 'failed') {
                         setStatus('failed');
                         onStatusChange('failed');
                         toast.error('Generation failed on server');
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [campaignId, renderMode, status, csvData.length, onPinGenerated, onProgressUpdate, onStatusChange]);

    // ============================================
    // Render Single Pin with Fabric (Client-side)
    // ============================================
    const renderPinClient = useCallback(async (
        rowData: Record<string, string>,
        rowIndex: number
    ): Promise<{ blob: Blob; fileName: string; rowIndex: number; templateId: string | null }> => {
        // MULTI-TEMPLATE: Get the correct template for this row
        const templateData = getTemplateForRowIndex(rowIndex, rowData);
        
        // Acquire canvas from pool (Phase 2.3 optimization)
        const tStart = performance.now();
        const canvas = canvasPoolRef.current.acquire(templateData.canvasSize.width, templateData.canvasSize.height);

        try {
            // Render using shared engine with row-specific template
            await renderTemplate(
                canvas,
                templateData.elements,
                { width: templateData.canvasSize.width, height: templateData.canvasSize.height, backgroundColor: templateData.backgroundColor },
                rowData,
                fieldMapping as FieldMapping
            );
            const tRender = performance.now();

            // Export to blob - OPTIMIZED: Use JPEG directly (faster, smaller)
            // JPEG 0.8 offers excellent quality/size balance (visually similar to 0.9 but 20-30% smaller)
            const multiplier = QUALITY_MAP[settings.quality];
            const blob = await exportToBlob(canvas, { 
                multiplier, 
                format: 'jpeg', 
                quality: 0.8 
            });
            const tBlob = performance.now();

            // Log detailed timings
            if (DEBUG) {
                console.log(`[Perf] Pin ${rowIndex}: Template ${templateData.templateId?.slice(0, 8) || 'single'}, Render ${(tRender - tStart).toFixed(1)}ms, Blob ${(tBlob - tRender).toFixed(1)}ms`);
            }
            
            // MULTI-TEMPLATE: Update statistics
            updateTemplateStats(templateData.templateId, true);

            return {
                blob,
                fileName: `pin-${rowIndex + 1}.jpg`,
                rowIndex,
                templateId: templateData.templateId,
            };
        } catch (error) {
            // MULTI-TEMPLATE: Track failure
            updateTemplateStats(templateData.templateId, false);
            throw error;
        } finally {
            // Always release canvas back to pool
            canvasPoolRef.current.release(canvas);
        }
    }, [canvasSize, templateElements, backgroundColor, fieldMapping, settings.quality, getTemplateForRowIndex, updateTemplateStats]);

    // ============================================
    // Start Generation (BATCH Processing - 10x Faster)
    // ============================================
    const startGeneration = useCallback(async (startIndex: number = 0) => {
        if (status === 'processing') return;
        if (!isMountedRef.current) return;

        setStatus('processing');
        onStatusChange('processing');
        shouldPauseRef.current = false;

        // Initialize or adjust timing for ETA calculation
        if (startIndex === 0) {
            // Fresh start - reset all timing
            startTimeRef.current = Date.now();
            totalPausedDurationRef.current = 0;
        } else if (pausedAtRef.current) {
            // Resuming from pause - add paused duration
            totalPausedDurationRef.current += Date.now() - pausedAtRef.current;
            pausedAtRef.current = null;
        }

        // Determine render mode from user selection (not settings)
        setActiveMode(renderMode);
        log(`Starting BATCH generation in ${renderMode} mode from index ${startIndex}`);

        // BATCH_SIZE: Number of pins to render per batch iteration
        // Reduced to 5 to allow more frequent UI updates and prevent blocking
        const BATCH_SIZE = 5;
        
        // CLIENT_PARALLEL_LIMIT: Number of concurrent renders
        // Reduced to 2 to prevent saturating browser connection pool for image loading
        const CLIENT_PARALLEL_LIMIT = 2;

        // Pre-warm canvas pool for batch processing
        canvasPoolRef.current.prewarm(CLIENT_PARALLEL_LIMIT, canvasSize.width, canvasSize.height);

        let serverJobStarted = false; // Track server job status for cleanup in finally block

        // ============================================
        // FIX #4: Preload ALL unique images before rendering
        // ============================================
        if (renderMode === 'client') {
            const imageCache = getImageCache();
            
            // Only preload if cache is empty (first run or after clear)
            if (imageCache.getStats().cached === 0) {
                console.log('[ImageCache] Starting image preload...');
                const preloadStartTime = Date.now();
                
                // Extract all unique image URLs from template and CSV data
                const imageUrls = extractImageUrls(
                    templateElements,
                    csvData,
                    fieldMapping
                );
                
                if (imageUrls.length > 0) {
                    console.log(`[ImageCache] Found ${imageUrls.length} unique images to preload`);
                    await imageCache.preloadAll(imageUrls);
                    const stats = imageCache.getStats();
                    console.log(`[ImageCache] Preload completed in ${Date.now() - preloadStartTime}ms`, stats);
                } else {
                    console.warn('[ImageCache] No image URLs found to preload!');
                }
            }
        } else {
            console.log('[Server Mode] Skipping client-side image preload - server handles images directly');
        }

        const errors: Array<{ rowIndex: number; error: string }> = [];
        let current = startIndex;

        try {
            // ============================================
            // SERVER MODE: ASYNC "FIRE AND FORGET"
            // ============================================
            if (renderMode === 'server') {
                 try {
                    console.log(`[Server Mode] Sending batch job to server...`);
                    
                    const response = await fetch('/api/queue/start-generation', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            campaignId,
                            // elements, canvasSize, etc. are fetched by the worker from DB
                            csvRows: csvData.slice(startIndex), // Send all remaining rows (for count & data)
                            startIndex: startIndex,
                        }),
                    });

                    if (!response.ok) {
                        throw new Error(`Server returned ${response.status}`);
                    }

                    const result = await response.json();
                    
                    if (!result.success) {
                        throw new Error(result.error || 'Server rendering failed');
                    }

                    console.log(`[Server Mode] Batch job started:`, result.message);
                    
                    serverJobStarted = true; // Mark as started successfully

                    // Show initial toast
                    toast.success('Generation started in background!');
                    
                    // We don't loop here. The Realtime subscription will handle updates.
                    // We just exit the function and let the status remain 'processing'.
                    return;

                } catch (serverError) {
                    console.error(`[Server Mode] Job start failed:`, serverError);
                    toast.error('Failed to start server generation. Please try again.');
                    setStatus('failed');
                    onStatusChange('failed');
                    return; 
                }
            }


            // ============================================
            // CLIENT MODE: Process pins in batches
            // ============================================
            while (current < csvData.length && !shouldPauseRef.current) {
                if (!isMountedRef.current) return;

                const batchStart = current;
                const batchEnd = Math.min(current + BATCH_SIZE, csvData.length);
                const batchSize = batchEnd - batchStart;
                const batchStartTime = Date.now();

                log(`[Batch] Rendering pins ${batchStart}-${batchEnd - 1} (${batchSize} pins)`);

                // CLIENT MODE: Chunked parallel processing
                const batchRows = csvData.slice(batchStart, batchEnd);
                
                type RenderResult = {
                    success: boolean;
                    pinNumber: number;
                    blob?: Blob;
                    fileName?: string;
                    url?: string;
                    error?: string;
                    rowData: Record<string, string>;
                };

                const chunkResults: RenderResult[] = [];
                // batchRenderedPins was removed as we now save incrementally
                
                // Process in chunks of CLIENT_PARALLEL_LIMIT
                
                // Process in chunks of CLIENT_PARALLEL_LIMIT
                for (let chunkStart = 0; chunkStart < batchRows.length; chunkStart += CLIENT_PARALLEL_LIMIT) {
                    if (!isMountedRef.current || shouldPauseRef.current) break;
                    
                    const chunk = batchRows.slice(chunkStart, chunkStart + CLIENT_PARALLEL_LIMIT);
                    const chunkStartTime = performance.now();
                    
                    // Process chunk in parallel
                    const chunkPromises = chunk.map(async (rowData, i) => {
                        const rowIndex = batchStart + chunkStart + i;
                        try {
                            // 1. Render
                            const tRenderStart = performance.now();
                            const pin = await renderPinClient(rowData, rowIndex);
                            const tRenderEnd = performance.now();
                            
                            // 2. Upload immediately
                            const formData = new FormData();
                            formData.append('file', pin.blob, pin.fileName);
                            formData.append('campaign_id', campaignId);
                            formData.append('row_index', rowIndex.toString());

                            const uploadResponse = await fetch('/api/upload-pin', {
                                method: 'POST',
                                body: formData,
                            });
                            const tUploadEnd = performance.now();
                            
                            if (chunkStart === 0 && i < 3) {
                                console.log(`[Client Timing] Pin ${rowIndex}: render=${(tRenderEnd - tRenderStart).toFixed(0)}ms, upload=${(tUploadEnd - tRenderEnd).toFixed(0)}ms`);
                            }

                            const uploadResult = await uploadResponse.json();
                            
                            if (!uploadResult.url) {
                                throw new Error(uploadResult.error || 'Upload failed');
                            }

                            // 3. Update UI instantly
                            onPinGenerated({
                                id: `${campaignId}-${rowIndex}`,
                                rowIndex: rowIndex,
                                imageUrl: uploadResult.url,
                                status: 'completed',
                                csvData: rowData,
                            });

                            return { success: true, pinNumber: rowIndex, url: uploadResult.url, rowData };

                        } catch (error) {
                            console.error(`[Client] Pin ${rowIndex} failed:`, error);
                            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                            errors.push({ rowIndex, error: errorMessage });
                            
                            onPinGenerated({
                                id: `${campaignId}-${rowIndex}`,
                                rowIndex: rowIndex,
                                imageUrl: '',
                                status: 'failed',
                                errorMessage: errorMessage,
                                csvData: rowData,
                            });
                            
                            return { success: false, pinNumber: rowIndex, error: errorMessage, rowData };
                        }
                    });

                    const chunkResult = await Promise.all(chunkPromises);
                    chunkResults.push(...chunkResult);
                    
                    const chunkDuration = performance.now() - chunkStartTime;
                    const pinsPerSec = (chunk.length / (chunkDuration / 1000)).toFixed(2);
                    console.log(`[Client] Chunk ${Math.floor(chunkStart / CLIENT_PARALLEL_LIMIT)}: ${chunk.length} pins in ${chunkDuration.toFixed(0)}ms (${pinsPerSec} pins/sec)`);

                    // 🚀 INCREMENTAL SAVE: Save successful pins from this chunk to DB immediately
                    const pinsToSave = chunkResult.filter(r => r.success && r.url).map(p => ({
                        campaign_id: campaignId,
                        user_id: userId,
                        image_url: p.url,
                        data_row: { ...p.rowData, rowIndex: p.pinNumber }, // 🚀 CRITICAL: Persist rowIndex for reliable deduplication
                        status: 'completed',
                    }));

                    if (pinsToSave.length > 0) {
                        try {
                            await fetch('/api/generated-pins', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ pins: pinsToSave }),
                            });
                        } catch (dbError) {
                            console.error('[Client] Chunk DB save failed:', dbError);
                        }
                    }

                    // 🚀 INCREMENTAL SAVE (ERRORS): Persist failed pins
                    const failedToSave = chunkResult.filter(r => !r.success);
                    if (failedToSave.length > 0) {
                        for (const failed of failedToSave) {
                             try {
                                await fetch('/api/generated-pins', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    credentials: 'include',
                                    body: JSON.stringify({
                                        campaign_id: campaignId,
                                        user_id: userId,
                                        image_url: '',
                                        data_row: { ...csvData[failed.pinNumber], rowIndex: failed.pinNumber }, // 🚀 CRITICAL: Persist rowIndex
                                        status: 'failed',
                                        error_message: failed.error,
                                    }),
                                });
                            } catch (persistError) {
                                console.error(`[Batch] Failed to persist error for pin ${failed.pinNumber}:`, persistError);
                            }
                        }
                    }

                    // 🚀 INCREMENTAL PROGRESS: Update progress after every chunk
                    const currentProgress = batchStart + chunkStart + chunk.length;
                    
                    // Save progress to LocalStorage (Zustand)
                    throttledSaveProgressRef.current({
                        campaignId,
                        lastCompletedIndex: currentProgress - 1,
                        totalPins: csvData.length,
                        status: 'processing'
                    });

                    // Calculate timing metrics
                    const metrics = calculateProgressMetrics({
                        completed: currentProgress,
                        total: csvData.length,
                        startTime: startTimeRef.current,
                        pausedDuration: totalPausedDurationRef.current,
                        isPaused: false,
                        currentTime: Date.now(),
                    });

                    // Update UI Progress and Trigger DB Campaign Update (via page.tsx)
                    const newProgressData: GenerationProgress = {
                        current: currentProgress,
                        total: csvData.length,
                        percentage: Math.round((currentProgress / csvData.length) * 100),
                        status: 'generating',
                        errors,
                        startTime: startTimeRef.current,
                        elapsedTime: metrics.elapsedTimeMs,
                        pausedDuration: totalPausedDurationRef.current,
                        currentSpeed: metrics.pinsPerSecond,
                        estimatedTimeRemaining: metrics.etaSeconds * 1000,
                        currentPinTitle: `Pin ${currentProgress}`,
                        currentPinIndex: currentProgress,
                    };
                    setProgress(newProgressData);
                    onProgressUpdate(newProgressData);
                }
                
                // Batch complete
                current = batchEnd;
                
                if (!isMountedRef.current) return;
                if (shouldPauseRef.current) break;

                // Log batch completion
                const batchDuration = Date.now() - batchStartTime;
                log(`[Batch] Completed ${batchSize} pins in ${batchDuration}ms`);
            }

            if (!isMountedRef.current) return;

            // Final status for CLIENT MODE
            if (shouldPauseRef.current) {
                pausedAtRef.current = Date.now();
                setStatus('paused');
                onStatusChange('paused');
                throttledSaveProgressRef.current.flush();
                toast.info(`Paused at ${current}/${csvData.length} pins`);
            } else {
                setStatus('completed');
                onStatusChange('completed');
                clearProgress();
                toast.success('Generation completed!');
            }

        } catch (error) {
            console.error('Generation error:', error);
            if (isMountedRef.current) {
                setStatus('failed');
                onStatusChange('failed');
                toast.error('Generation failed');
            }
        } finally {
            if (isMountedRef.current) {
                setIsPausing(false);
                // Don't reset activeMode immediately if it's server mode waiting for realtime
                // But wait, server mode returns early, so this finally block runs immediately?
                // No, server mode returns early from the try block.
                // Ah, the finally block runs BEFORE return.
                // So activeMode will be nullified.
                // We should probably check if we are in server mode + processing before resetting.
                
                if (!(renderMode === 'server' && serverJobStarted)) {
                     setActiveMode(null);
                }
            }
            // Log pool stats for performance monitoring
            log('Canvas pool stats:', canvasPoolRef.current.getStats());
        }
    }, [
        status, templateElements, canvasSize, backgroundColor, csvData,
        fieldMapping, campaignId, userId, onPinGenerated, onProgressUpdate,
        onStatusChange, clearProgress, renderPinClient, renderMode
    ]);

    // Pause generation
    const pauseGeneration = useCallback(() => {
        if (settings.pauseEnabled && status === 'processing') {
            setIsPausing(true);
            shouldPauseRef.current = true;
        }
    }, [settings.pauseEnabled, status]);

    // Resume generation
    const resumeGeneration = useCallback(() => {
        if (status === 'paused') {
             // SMART RESUME LOGIC (Matching Green Button)
             // Calculate best resume index by checking all reliable sources
             const lastDbIndex = generatedCount ? generatedCount - 1 : -1;
             const savedIndex = savedState ? savedState.lastCompletedIndex : -1;
             const currentIndex = progress.current > 0 ? progress.current - 1 : -1;
             
             // Pick the furthest progress point
             const bestLastIndex = Math.max(lastDbIndex, savedIndex, currentIndex);
             
             // Start from the NEXT pin
             startGeneration(bestLastIndex + 1);
        }
    }, [status, progress.current, generatedCount, savedState, startGeneration]);

    // Regenerate all
    const regenerateAll = useCallback(async () => {
        const confirmed = window.confirm(
            `This will delete ${progress.current} existing pins and start fresh. Continue?`
        );
        if (!confirmed) return;

        await fetch(`/api/generated-pins?campaign_id=${campaignId}`, {
            method: 'DELETE',
        });

        setProgress({
            current: 0,
            total: csvData.length,
            percentage: 0,
            status: 'idle',
            errors: [],
            startTime: null,
            elapsedTime: 0,
            pausedDuration: 0,
            currentSpeed: 0,
            estimatedTimeRemaining: 0,
            currentPinTitle: '',
            currentPinIndex: 0,
        });

        startGeneration(0);
    }, [campaignId, csvData.length, progress.current, startGeneration]);

    // Map status for tracker component
    const trackerStatus = status === 'processing' ? 'generating' 
        : status === 'failed' ? 'error' 
        : status === 'completed' ? 'completed'
        : status === 'paused' ? 'paused'
        : 'idle';

    return (
        <div className="space-y-4">
            {/* Enhanced Progress Tracker */}
            <EnhancedProgressTracker
                completed={generatedCount || progress.current}
                total={csvData.length}
                status={trackerStatus}
                pinsPerSecond={progress.currentSpeed}
                elapsedTimeMs={progress.elapsedTime}
                etaFormatted={progress.estimatedTimeRemaining > 0 
                    ? formatDuration(progress.estimatedTimeRemaining) 
                    : '--'}
                isEtaReliable={(generatedCount || progress.current) >= 5}
                currentPinTitle={progress.currentPinTitle}
                currentPinIndex={progress.currentPinIndex}
                pauseEnabled={settings.pauseEnabled && renderMode !== 'server'}
                isPausing={isPausing}
                onPause={pauseGeneration}
                onResume={resumeGeneration}
                errorCount={progress.errors.length}
            />

            {/* Render Mode Indicator */}
            {activeMode && (
                <div className="flex items-center gap-2 text-sm text-gray-500 px-2">
                    <span className="flex items-center gap-1 text-xs bg-gray-100 px-2 py-0.5 rounded">
                        {activeMode === 'server' ? <Server className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
                        {activeMode === 'server' ? 'Server Rendering' : 'Client Rendering'}
                    </span>
                </div>
            )}

            {/* Resume from Saved State - SMART RESUME LOGIC */}
            {canResume && !isStale && status !== 'processing' && status !== 'completed' && savedState && (() => {
                // Calculate smart resume index: Max of local saved state OR confirmed DB count
                const lastDbIndex = generatedCount ? generatedCount - 1 : -1;
                const smartLastIndex = Math.max(savedState.lastCompletedIndex, lastDbIndex);
                const pinsRemaining = Math.max(0, csvData.length - smartLastIndex - 1);
                
                if (pinsRemaining <= 0) return null;

                return (
                    <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex-1">
                            <p className="text-sm font-medium text-green-900">
                                Resume Available
                            </p>
                            <p className="text-xs text-green-700">
                                {pinsRemaining} of {csvData.length} pins remaining
                            </p>
                        </div>
                        <button
                            onClick={() => {
                                startGeneration(smartLastIndex + 1);
                                toast.info(`Resuming from pin ${smartLastIndex + 2}`);
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Resume
                        </button>
                        <button
                            onClick={() => {
                                clearProgress();
                                toast.success('Cleared saved progress');
                            }}
                            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                        >
                            Clear
                        </button>
                    </div>
                );
            })()}

            {/* Render Mode Selector - Only show when not processing */}
            {(status === 'pending' || status === 'failed' || status === 'completed' || status === 'paused') && (
                <div className="p-4 bg-gray-50 rounded-lg border">
                    <div className="text-sm font-medium mb-3 text-gray-700">Render Mode</div>
                    <div className="space-y-2">
                        {/* Client Mode Option */}
                        <label 
                            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                                ${renderMode === 'client' 
                                    ? 'border-blue-300 bg-blue-50' 
                                    : 'border-gray-200 hover:bg-gray-100'}`}
                        >
                            <input 
                                type="radio" 
                                name="renderMode"
                                checked={renderMode === 'client'} 
                                onChange={() => setRenderMode('client')}
                                className="mt-1"
                            />
                            <div className="flex-1">
                                <div className="font-medium text-gray-900 flex items-center gap-2">
                                    <Monitor className="w-4 h-4" />
                                    Client-Side
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5">
                                    Fast preview for 1-10 pins. Runs in your browser.
                                </div>
                            </div>
                        </label>
                        
                        {/* Server Mode Option - Recommended for bulk */}
                        <label 
                            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                                ${renderMode === 'server' 
                                    ? 'border-green-300 bg-green-50' 
                                    : 'border-gray-200 hover:bg-gray-100'}`}
                        >
                            <input 
                                type="radio" 
                                name="renderMode"
                                checked={renderMode === 'server'} 
                                onChange={() => setRenderMode('server')}
                                className="mt-1"
                            />
                            <div className="flex-1">
                                <div className="font-medium text-gray-900 flex items-center gap-2">
                                    <Server className="w-4 h-4" />
                                    Server-Side
                                    <span className="text-xs bg-green-500 text-white px-1.5 py-0.5 rounded font-normal">
                                        Recommended
                                    </span>
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5">
                                    Faster for bulk generation (100+ pins). Requires Vercel deployment.
                                </div>
                            </div>
                        </label>
                    </div>
                </div>
            )}

            {/* Action Buttons - Added relative/z-index to fix overlapping issues */}
            <div className="flex items-center gap-3 relative z-10">
                {/* Start Button - only when idle AND no resume available */}
                {/* Start/Resume Button - Handles both fresh start and DB resume (when local storage is empty) */}
                {(status === 'pending' || status === 'failed') && !canResume && (() => {
                    const dbStartIndex = generatedCount ? generatedCount : 0;
                    const sessionIndex = progress.current || 0;
                    const startIndex = Math.max(dbStartIndex, sessionIndex);
                    const isResuming = startIndex > 0;

                    return (
                        <button
                            onClick={() => {
                                startGeneration(startIndex);
                            }}
                            className={`flex items-center gap-2 px-6 py-3 text-white rounded-lg font-medium transition-colors shadow-sm active:scale-95 ${
                                isResuming ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
                            }`}
                        >
                            <Play className="w-5 h-5" />
                            {isResuming ? 'Resume Generation' : 'Start Generation'}
                        </button>
                    );
                })()}

                {/* Regenerate All Button */}
                {(status === 'paused' || status === 'completed') && progress.current > 0 && (
                    <button
                        onClick={regenerateAll}
                        className="flex items-center gap-2 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                    >
                        <RotateCcw className="w-5 h-5" />
                        Regenerate All
                    </button>
                )}
            </div>
        </div>
    );
}