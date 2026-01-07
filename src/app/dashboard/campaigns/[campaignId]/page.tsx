'use client';

// Debug logging - only in development
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => DEBUG && console.log(...args);

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/AuthContext';
import { getCampaign, updateCampaign, CampaignWithDetails } from '@/lib/db/campaigns';
import { getTemplate } from '@/lib/db/templates';
import { supabase } from '@/lib/supabase';
import { GenerationController, DEFAULT_GENERATION_SETTINGS } from '@/components/campaign/GenerationController';
import { PinsGrid, PinCardData } from '@/components/campaign/PinCard';
import { ExportToolbar } from '@/components/campaign/ExportToolbar';
import { CampaignDashboardCard } from '@/components/campaign/CampaignDashboardCard';
import { PinPreviewModal } from '@/components/campaign/PinPreviewModal';
import { SelectionActionBar, DeleteConfirmationModal } from '@/components/ui/BulkActions';
import { Element, CanvasSize } from '@/types/editor';
import { toast } from 'sonner';


export default function CampaignDetailPage() {
    const params = useParams();
    const router = useRouter();
    const campaignId = params.campaignId as string;
    const { currentUser, loading: authLoading } = useAuth();

    const [campaign, setCampaign] = useState<CampaignWithDetails | null>(null);
    const [templateData, setTemplateData] = useState<{
        name: string;
        thumbnail_url?: string | null;
        canvas_size?: { width: number; height: number };
    } | null>(null);
    const [template, setTemplate] = useState<{
        elements: Element[];
        canvas_size: CanvasSize;
        background_color: string;
    } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [generatedPins, setGeneratedPins] = useState<PinCardData[]>([]);
    
    // Filter and Selection State
    const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'failed'>('all');
    const [selectAllScope, setSelectAllScope] = useState<'page' | 'all'>('page');

    const [settings] = useState(DEFAULT_GENERATION_SETTINGS);
    
    // Render mode state (persisted to localStorage)
    const [renderMode, setRenderMode] = useState<'client' | 'server'>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('pinGeneratorRenderMode');
            if (saved === 'client' || saved === 'server') return saved;
        }
        return 'server'; // Default to server
    });
    
    // Generation progress state for dashboard card
    const [generationProgress, setGenerationProgress] = useState({
        current: 0,
        total: 0,
        percentage: 0,
    });
    const [generationSpeed, setGenerationSpeed] = useState(0);
    const [completedAt, setCompletedAt] = useState<string | undefined>(undefined);

    const [previewPin, setPreviewPin] = useState<PinCardData | null>(null);

    // Bulk selection state
    const [selectedPinIds, setSelectedPinIds] = useState<Set<string>>(new Set());
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });
    // URL State Management
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const [pinToDelete, setPinToDelete] = useState<PinCardData | null>(null);

    // Initialize pagination from URL or defaults
    const [pagination, setPagination] = useState({ 
        page: Number(searchParams.get('page')) || 1, 
        limit: Number(searchParams.get('limit')) || 10, // Default to 10 per page
        hasMore: true, 
        total: 0, 
        isLoading: false 
    });
    
    const ITEMS_PER_PAGE = pagination.limit;
    const [currentPage, setCurrentPage] = useState(pagination.page);

    // Sort state synced with URL
    const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'created_at_desc');

    // Sync currentPage with pagination state
    useEffect(() => {
        if (pagination.page !== currentPage) {
            setCurrentPage(pagination.page);
            setGoToPageInput(String(pagination.page));
        }
    }, [pagination.page, currentPage]);

    const [goToPageInput, setGoToPageInput] = useState(String(pagination.page));

    // Update URL helper
    const updateUrl = useCallback((newPage: number, newLimit: number, newSort: string = sortBy) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('page', String(newPage));
        params.set('limit', String(newLimit));
        params.set('sort', newSort);
        router.push(`${pathname}?${params.toString()}`);
    }, [searchParams, pathname, router, sortBy]);

    // Redirect if not authenticated
    useEffect(() => {
        if (!authLoading && !currentUser) {
            router.push('/login');
        }
    }, [authLoading, currentUser, router]);

    // Update local state when URL changes (handle back/forward)
    useEffect(() => {
        const p = Number(searchParams.get('page')) || 1;
        const l = Number(searchParams.get('limit')) || 10;
        const s = searchParams.get('sort') || 'created_at_desc';
        
        setPagination(prev => {
            if (prev.page === p && prev.limit === l) return prev;
            return { ...prev, page: p, limit: l };
        });
        setSortBy(s);
        setGoToPageInput(String(p));
    }, [searchParams]);

    // Load campaign stats (polled)
    const loadCampaignData = useCallback(async (isPolling = false) => {
        if (!campaignId) return;

        // Only show full loading spinner on initial mount
        if (!isPolling && !campaign) setIsLoading(true);
        
        try {
            // Load campaign
            const campaignData = await getCampaign(campaignId);
            if (!campaignData) {
                if (!isPolling) {
                    toast.error('Campaign not found');
                    router.push('/dashboard/campaigns');
                }
                return;
            }
            
            // Update campaign state
            setCampaign(campaignData);
            
            // Sync progress state for dashboard card
            const csvDataFromCampaign = (campaignData.csv_data || []) as Record<string, string>[];
            const total = csvDataFromCampaign.length;
            const current = campaignData.generated_pins || 0;
            setGenerationProgress({
                current,
                total,
                percentage: total > 0 ? (current / total) * 100 : 0,
            });
            
            // Set completed timestamp if available
            if (campaignData.completed_at) {
                setCompletedAt(campaignData.completed_at);
            }

            // Load template if not already loaded (this is one-off)
            if (!templateData) {
                const fetchedTemplate = await getTemplate(campaignData.template_id);
                if (fetchedTemplate) {
                    setTemplateData(fetchedTemplate);
                    setTemplate({
                        elements: fetchedTemplate.elements as Element[],
                        canvas_size: fetchedTemplate.canvas_size as CanvasSize,
                        background_color: fetchedTemplate.background_color || '#ffffff',
                    });
                }
            }
        } catch (error) {
            console.error('Error loading campaign:', error);
            if (!isPolling) toast.error('Failed to load campaign');
        } finally {
            if (!isPolling) setIsLoading(false);
        }
    }, [campaignId, router, templateData, campaign]); // adding deps

    // Initial load
    useEffect(() => {
        loadCampaignData(false);
    }, [campaignId]); // eslint-disable-line react-hooks/exhaustive-deps 
    // We intentionally only want this to run on mount/id change. 
    // The poll handles updates.
    


    // Function to load generated pins
    const loadGeneratedPins = useCallback(async (
        pageToLoad: number = pagination.page, 
        limitToLoad: number = pagination.limit,
        sortToLoad: string = sortBy
    ) => {
        if (!campaignId) return;
        if (pagination.isLoading) return;

        try {
            setPagination(prev => ({ ...prev, isLoading: true }));
            log(`Loading pins page ${pageToLoad} limit ${limitToLoad}...`);
            
            // Get current session token
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const headers: Record<string, string> = {
                'Cache-Control': 'no-store'
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const pinsResponse = await fetch(
                `/api/generated-pins?campaign_id=${campaignId}&page=${pageToLoad}&limit=${limitToLoad}&sort=${sortToLoad}&t=${Date.now()}`, 
                { 
                    credentials: 'include',
                    headers
                }
            );
            
            // Handle non-200 responses
            if (!pinsResponse.ok) {
                const errorData = await pinsResponse.json();
                throw new Error(errorData.error || `Server error: ${pinsResponse.status}`);
            }

            const pinsResult = await pinsResponse.json();

            if (pinsResult.success && pinsResult.data) {
                const mappedPins: PinCardData[] = pinsResult.data
                    // .filter((pin: Record<string, unknown>) => pin.image_url) // REMOVE FILTER to see all pins
                    .map((pin: Record<string, unknown>, index: number) => {
                        const dataRow = pin.data_row as Record<string, unknown> | undefined;
                        // Use actual row index if available, otherwise calculate
                        const rowIndex = typeof dataRow?.rowIndex === 'number' 
                            ? dataRow.rowIndex 
                            : ((pageToLoad - 1) * limitToLoad + index);
                        
                        return {
                            id: (pin.id as string) || `pin-${index}`,
                            rowIndex,
                            imageUrl: pin.image_url as string,
                            status: ((pin.status as string) === 'generated' ? 'completed' : (pin.status as 'pending' | 'processing' | 'failed' | 'completed')) || 'completed',
                            errorMessage: pin.error_message as string | undefined,
                            csvData: (pin.data_row || {}) as Record<string, string>,
                        };
                    });

                // Server-side pagination: Replace pins fully
                setGeneratedPins(mappedPins);

                if (pinsResult.meta) {
                    setPagination(prev => ({
                        ...prev,
                        page: pageToLoad, 
                        limit: limitToLoad,
                        hasMore: pinsResult.meta.hasMore,
                        total: pinsResult.meta.total,
                    }));
                    setCurrentPage(pageToLoad);
                    setGoToPageInput(String(pageToLoad));
                }
            } else {
                 console.warn('Pins API returned success=false', pinsResult);
                 toast.error(`Failed to load pins: ${pinsResult.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Error loading pins:', error);
            const msg = error instanceof Error ? error.message : String(error);
            toast.error(`Load error: ${msg}`);
        } finally {
            setPagination(prev => ({ ...prev, isLoading: false }));
        }
    }, [campaignId, pagination.isLoading, pagination.page, pagination.limit, sortBy]);

    // Dedicated Sync Effect - Ensures fresh campaign state
    useEffect(() => {
        if (!campaign || pagination.isLoading) return;

        // Sync campaign progress if mismatch detected
        if (pagination.total > 0 && campaign.generated_pins !== pagination.total) {
            log(`Syncing campaign progress: ${campaign.generated_pins} -> ${pagination.total}`);
            updateCampaign(campaign.id, {
                generated_pins: pagination.total,
                current_index: pagination.total
            }).then((success) => {
                if (success) {
                    setCampaign(prev => prev ? { ...prev, generated_pins: pagination.total, current_index: pagination.total } : null);
                    // Force a reload if we have total but no pins locally (edge case)
                    if (generatedPins.length === 0) {
                        loadGeneratedPins(pagination.page, pagination.limit);
                    }
                }
            });
        }
    }, [campaign, pagination.total, pagination.isLoading, generatedPins.length, loadGeneratedPins]);

    // Reload pins when campaign status changes to completed
    useEffect(() => {
        // Only reload if we expect pins but have none
        // Check pagination.total to avoid loop if we know it's empty
        if (campaign?.status === 'completed' && generatedPins.length === 0 && pagination.total > 0) {
            log('Campaign completed but pins missing locally - reloading...');
            loadGeneratedPins(1);
        }
    }, [campaign?.status, generatedPins.length, pagination.total, loadGeneratedPins, pagination.limit]);

    // Track if we have performed the initial load
    const initialLoadRef = useRef(false);

    // Load pins when campaign is first loaded
    useEffect(() => {
        // If campaign is loaded and we haven't tried loading pins yet
        if (campaign && !isLoading && !initialLoadRef.current) {
            log('Initial pin load triggered');
            initialLoadRef.current = true;
            loadGeneratedPins(1);
        }
    }, [campaign, isLoading, loadGeneratedPins]);

    // Handle pin generated
    const handlePinGenerated = useCallback((pin: PinCardData) => {
        setGeneratedPins((prev) => {
            const existing = prev.findIndex((p) => p.rowIndex === pin.rowIndex);
            if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = pin;
                return updated;
            }
            // Just append, let displayedPins handle sorting
            return [...prev, pin];
        });
    }, []);

    // Handle progress update from GenerationController
    const handleProgressUpdate = useCallback((progress: { current: number; total: number; percentage: number; currentSpeed?: number }) => {
        setGenerationProgress({
            current: progress.current,
            total: progress.total,
            percentage: progress.percentage,
        });
        if (progress.currentSpeed !== undefined) {
            setGenerationSpeed(progress.currentSpeed);
        }
    }, []);

    // Handle status change
    const handleStatusChange = useCallback(async (status: string) => {
        if (campaign) {
            log('[CampaignPage] Updating status to:', status, 'for campaign:', campaign.id);
            const updateData: Record<string, unknown> = { status };
            if (status === 'paused') {
                updateData.paused_at = new Date().toISOString();
            } else if (status === 'completed') {
                // FIX: Only set completed_at if not already set (prevents reset on refresh)
                if (!campaign.completed_at && !completedAt) {
                    const now = new Date().toISOString();
                    updateData.completed_at = now;
                    setCompletedAt(now);
                }
            }
            const success = await updateCampaign(campaign.id, updateData);
            log('[CampaignPage] Update result:', success);
            if (success) {
                setCampaign((prev) => prev ? { ...prev, status: status as 'pending' | 'processing' | 'paused' | 'completed' | 'failed' } : null);
            }
        }
    }, [campaign, completedAt]);

    // Handle pin preview
    const handlePreview = useCallback((pin: PinCardData) => {
        setPreviewPin(pin);
    }, []);

    // Handle pin selection
    const handleSelectPin = useCallback((pinId: string, selected: boolean) => {
        setSelectedPinIds(prev => {
            const next = new Set(prev);
            if (selected) {
                next.add(pinId);
            } else {
                next.delete(pinId);
            }
            return next;
        });
    }, []);

    // ... (rest of code) ...

    // Derived state for filtering and pagination
    const filteredPins = React.useMemo(() => {
        return generatedPins.filter(pin => {
            if (filterStatus === 'all') return true;
            return pin.status === filterStatus;
        });
    }, [generatedPins, filterStatus]);

    // Use total from API
    const totalPages = Math.ceil(pagination.total / ITEMS_PER_PAGE);

    const displayedPins = React.useMemo(() => {
        // Sort filtered pins based on current sortBy state
        const sorted = [...filteredPins].sort((a, b) => {
            switch (sortBy) {
                case 'created_at_desc':
                    // For generated pins, higher rowIndex usually means newer
                    // Ideally we'd valid created_at, but rowIndex is a good proxy for live generation
                    return b.rowIndex - a.rowIndex;
                case 'created_at_asc':
                     return a.rowIndex - b.rowIndex;
                case 'index_asc':
                    return a.rowIndex - b.rowIndex;
                default:
                    return b.rowIndex - a.rowIndex;
            }
        });
        return sorted;
    }, [filteredPins, sortBy]);

    // Calculate counts for tabs
    const counts = React.useMemo(() => ({
        all: generatedPins.length,
        completed: generatedPins.filter(p => p.status === 'completed').length,
        failed: generatedPins.filter(p => p.status === 'failed').length
    }), [generatedPins]);

    // Select all pins (filtered)
    const handleSelectAll = useCallback(() => {
        setSelectAllScope('page');
        setSelectedPinIds(new Set(filteredPins.map(p => p.id)));
    }, [filteredPins]);

    // Select entire campaign from DB
    const handleSelectEntireCampaign = useCallback(() => {
        setSelectAllScope('all');
        // Visually select all loaded pins too so UI looks consistent
        setSelectedPinIds(new Set(filteredPins.map(p => p.id))); 
    }, [filteredPins]);

    // Deselect all pins
    const handleDeselectAll = useCallback(() => {
        setSelectAllScope('page');
        setSelectedPinIds(new Set());
    }, []);

    // Delete single pin
    const handleDeletePin = useCallback((pin: PinCardData) => {
        setPinToDelete(pin);
        setShowDeleteModal(true);
    }, []);

    // Handle bulk delete
    const handleDeleteSelected = useCallback(() => {
        if (selectedPinIds.size > 0) {
            setPinToDelete(null);
            setShowDeleteModal(true);
        }
    }, [selectedPinIds]);

    // Confirm delete
    const handleConfirmDelete = useCallback(async () => {
        // If "Delete All from DB" mode is active
        if (selectAllScope === 'all') {
             setIsDeleting(true);
             // Fake progress for improved UX or use infinite
             setDeleteProgress({ current: 0, total: pagination.total });

             try {
                 const response = await fetch(`/api/generated-pins?campaign_id=${campaignId}`, { method: 'DELETE' });
                 const data = await response.json();

                 if (response.ok && data.success) {
                     toast.success(`All generated pins deleted successfully`);
                     setGeneratedPins([]);
                     setSelectedPinIds(new Set());
                     setSelectAllScope('page');
                     
                     // Reset local pagination/counts
                     setPagination(prev => ({ ...prev, total: 0 }));

                     // 🚀 CRITICAL: Reset campaign progress in DB
                     await updateCampaign(campaignId, {
                        generated_pins: 0,
                        current_index: 0,
                        status: 'pending' // Reset status to pending so it can be started again
                     });
                     setCampaign(prev => prev ? { ...prev, generated_pins: 0, current_index: 0, status: 'pending' } : null);
                     
                      // Reload to confirm empty state
                      await loadGeneratedPins(1, pagination.limit, sortBy);
                      updateUrl(1, pagination.limit, sortBy);
                 } else {
                     throw new Error(data.error || 'Failed to delete all pins');
                 }
             } catch (error) {
                 console.error('Bulk delete error:', error);
                 toast.error('Failed to delete all pins');
             } finally {
                 setIsDeleting(false);
                 setShowDeleteModal(false);
                 setPinToDelete(null);
                 setDeleteProgress({ current: 0, total: 0 });
             }
             return;
        }

        const idsToDelete = pinToDelete ? [pinToDelete.id] : Array.from(selectedPinIds);
        if (idsToDelete.length === 0) return;

        setIsDeleting(true);
        setDeleteProgress({ current: 0, total: idsToDelete.length });

        let successCount = 0;
        const failedIds: string[] = [];

        try {
            for (let i = 0; i < idsToDelete.length; i++) {
                const pinId = idsToDelete[i];
                try {
                    const response = await fetch(`/api/generated-pins/${pinId}`, { method: 'DELETE' });
                    const data = await response.json();

                    if (response.ok && data.success) {
                        successCount++;
                        log(`[delete] Pin ${pinId} deleted successfully`);
                    } else {
                        console.error(`[delete] Failed to delete pin ${pinId}:`, data.error);
                        failedIds.push(pinId);
                    }
                } catch (fetchError) {
                    console.error(`[delete] Fetch error for pin ${pinId}:`, fetchError);
                    failedIds.push(pinId);
                }
                setDeleteProgress({ current: i + 1, total: idsToDelete.length });
            }

            // Only remove successfully deleted pins from state
            if (successCount > 0) {
                const successfulIds = idsToDelete.filter(id => !failedIds.includes(id));
                setGeneratedPins(prev => prev.filter(p => !successfulIds.includes(p.id)));
                setSelectedPinIds(new Set());
                toast.success(`${successCount} pin${successCount > 1 ? 's' : ''} deleted successfully`);

                // Reload pins from database to ensure sync
                await loadGeneratedPins(currentPage, pagination.limit);
            }

            if (failedIds.length > 0) {
                toast.error(`Failed to delete ${failedIds.length} pin${failedIds.length > 1 ? 's' : ''}`);
            }
        } catch (error) {
            console.error('Delete error:', error);
            toast.error('Failed to delete pins');
            // Reload pins from database on error to restore correct state
            await loadGeneratedPins(currentPage);
        } finally {
            setIsDeleting(false);
            setShowDeleteModal(false);
            setPinToDelete(null);
        }
    }, [pinToDelete, selectedPinIds, loadGeneratedPins, selectAllScope, campaignId, pagination.total, currentPage, updateUrl, pagination.limit, sortBy]);

    if (authLoading || isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    if (!campaign || !template) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <p className="text-gray-500">Campaign not found</p>
            </div>
        );
    }

    const csvData = (campaign.csv_data || []) as Record<string, string>[];
    const fieldMapping = (campaign.field_mapping || {}) as Record<string, string>;

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header - Minimal */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
                <div className="max-w-7xl mx-auto px-6 py-3">
                    <Link
                        href="/dashboard/campaigns"
                        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span className="text-sm font-medium">Back to Campaigns</span>
                    </Link>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-4 space-y-4">
                {/* Unified Campaign Dashboard Card */}
                <CampaignDashboardCard
                    campaignName={campaign.name}
                    templateName={templateData?.name}
                    templateThumbnail={templateData?.thumbnail_url || undefined}
                    canvasSize={templateData?.canvas_size}
                    csvRowCount={csvData.length}
                    createdAt={campaign.created_at}
                    renderMode={renderMode}
                    onRenderModeChange={(mode) => {
                        setRenderMode(mode);
                        localStorage.setItem('pinGeneratorRenderMode', mode);
                    }}
                    disabled={campaign.status === 'processing'}
                    status={campaign.status}
                    progress={generationProgress}
                    completedAt={completedAt}
                    speed={generationSpeed}
                />

                {/* Generation Controller - Minimal (only buttons) */}
                <GenerationController
                    campaignId={campaign.id}
                    userId={currentUser?.id || ''}
                    templateElements={template.elements}
                    canvasSize={template.canvas_size}
                    backgroundColor={template.background_color}
                    templateSnapshots={campaign.template_snapshot || undefined}
                    distributionMode={campaign.distribution_mode || 'sequential'}
                    csvData={csvData}
                    fieldMapping={fieldMapping}
                    initialSettings={settings}
                    initialProgress={campaign.current_index || 0}
                    initialStatus={campaign.status}
                    generatedCount={Math.max(generatedPins.length, pagination.total)}
                    onPinGenerated={handlePinGenerated}
                    onProgressUpdate={handleProgressUpdate}
                    onStatusChange={handleStatusChange}
                    minimal={true}
                />

                {/* Pins Grid with Unified Header and Secondary Toolbar */}
                {generatedPins.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                                {/* Primary Header: Title & Global Actions */}
                                <div className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4 bg-white">
                                    <div className="flex items-center gap-3">
                                        <h3 className="font-bold text-gray-900 text-lg tracking-tight">
                                            Generated Pins
                                        </h3>
                                        {selectedPinIds.size > 0 && (
                                            <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full border border-blue-100">
                                                {selectedPinIds.size} selected
                                            </span>
                                        )}
                                    </div>
                                    
                                    <ExportToolbar
                                        pins={generatedPins}
                                        campaignName={campaign.name}
                                        csvData={csvData}
                                        totalCount={pagination.total}
                                        isEntireCampaignSelected={selectAllScope === 'all'}
                                        minimal={true}
                                    />
                                </div>

                                {/* Secondary Toolbar: Filters & View Controls */}
                                <div className="px-4 py-2 bg-gray-50 border-t border-b border-gray-100 flex flex-col xl:flex-row items-center justify-between gap-4">
                                    {/* Left: Filter Tabs (Clean Pills) */}
                                    <div className="flex items-center gap-2">
                                        {(['all', 'completed', 'failed'] as const).map((status) => (
                                            <button
                                                key={status}
                                                onClick={() => setFilterStatus(status)}
                                                className={cn(
                                                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-2 border",
                                                    filterStatus === status
                                                        ? "bg-orange-600 text-white border-orange-600 shadow-sm"
                                                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                                                )}
                                            >
                                                {status === 'all' && 'All'}
                                                {status === 'completed' && 'Success'}
                                                {status === 'failed' && 'Failed'}
                                                
                                                <span className={cn(
                                                    "text-[10px] px-1.5 py-0.5 rounded-full",
                                                    filterStatus === status 
                                                        ? "bg-white/20 text-white" 
                                                        : "bg-gray-100 text-gray-600"
                                                )}>
                                                    {counts[status]}
                                                </span>
                                            </button>
                                        ))}
                                    </div>

                                    {/* Right: Pagination & Display Controls */}
                                    <div className="flex flex-wrap items-center gap-4 justify-end">
                                        <span className="text-xs text-gray-500 font-medium">
                                            Showing <span className="font-bold text-gray-900">{((currentPage - 1) * pagination.limit) + 1}-{Math.min(currentPage * pagination.limit, pagination.total)}</span> of <span className="font-bold text-gray-900">{pagination.total}</span>
                                        </span>

                                        <div className="h-4 w-px bg-gray-300 hidden sm:block"></div>

                                        {/* Controls Group */}
                                        <div className="flex items-center gap-2">
                                            {/* Limit Selector */}
                                            <div className="relative">
                                                <select
                                                    value={pagination.limit}
                                                    onChange={(e) => {
                                                        const newLimit = Number(e.target.value);
                                                        updateUrl(1, newLimit, sortBy);
                                                        loadGeneratedPins(1, newLimit, sortBy);
                                                    }}
                                                    className="appearance-none bg-white border border-gray-300 hover:border-gray-400 text-gray-700 text-xs font-medium rounded-md py-1.5 pl-3 pr-7 cursor-pointer focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                                                >
                                                    {[10, 20, 30, 50, 100].map(size => (
                                                        <option key={size} value={size}>{size} / page</option>
                                                    ))}
                                                </select>
                                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                                </div>
                                            </div>

                                            {/* Sort Selector */}
                                            <div className="relative">
                                                <select
                                                    value={sortBy}
                                                    onChange={(e) => {
                                                        const newSort = e.target.value;
                                                        setSortBy(newSort);
                                                        updateUrl(1, pagination.limit, newSort);
                                                        loadGeneratedPins(1, pagination.limit, newSort);
                                                    }}
                                                    className="appearance-none bg-white border border-gray-300 hover:border-gray-400 text-gray-700 text-xs font-medium rounded-md py-1.5 pl-3 pr-7 cursor-pointer focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                                                >
                                                    <option value="created_at_desc">Newest</option>
                                                    <option value="created_at_asc">Oldest</option>
                                                    <option value="row_index_desc">Row (High→Low)</option>
                                                    <option value="row_index_asc">Row (Low→High)</option>
                                                </select>
                                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                                </div>
                                            </div>

                                            {/* Refresh Button */}
                                            <button
                                                onClick={() => loadGeneratedPins(currentPage, pagination.limit, sortBy)}
                                                disabled={pagination.isLoading}
                                                className="h-8 w-8 flex items-center justify-center text-gray-600 hover:text-orange-600 hover:bg-orange-50 rounded-md border border-gray-300 hover:border-orange-200 transition-all bg-white"
                                                title="Refresh list"
                                            >
                                                <RefreshCw className={cn("w-3.5 h-3.5", pagination.isLoading && "animate-spin")} />
                                            </button>
                                        </div>

                                        <div className="h-4 w-px bg-gray-300 hidden sm:block"></div>

                                        {/* Pagination Arrows */}
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => {
                                                    const p = Math.max(1, currentPage - 1);
                                                    updateUrl(p, pagination.limit, sortBy);
                                                    loadGeneratedPins(p, pagination.limit, sortBy);
                                                }}
                                                disabled={currentPage === 1}
                                                className="h-8 w-8 flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <span className="sr-only">Previous</span>
                                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                                            </button>

                                            {/* Page Input */}
                                            <div className="flex items-center mx-1">
                                                 <input 
                                                    type="text"
                                                    value={goToPageInput}
                                                    onChange={(e) => setGoToPageInput(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            const p = parseInt(goToPageInput);
                                                            if (!isNaN(p) && p >= 1 && p <= totalPages) {
                                                                updateUrl(p, pagination.limit, sortBy);
                                                                loadGeneratedPins(p, pagination.limit, sortBy);
                                                            }
                                                        }
                                                    }}
                                                    className="w-10 h-8 px-1 text-xs text-center border border-gray-300 rounded-md focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                                                />
                                                <span className="text-xs text-gray-500 ml-1">/ {totalPages}</span>
                                            </div>

                                            <button
                                                onClick={() => {
                                                    const p = Math.min(totalPages, currentPage + 1);
                                                    updateUrl(p, pagination.limit, sortBy);
                                                    loadGeneratedPins(p, pagination.limit, sortBy);
                                                }}
                                                disabled={currentPage === totalPages}
                                                className="h-8 w-8 flex items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <span className="sr-only">Next</span>
                                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="p-6 bg-gray-50/30 min-h-[500px]">
                                    {displayedPins.length > 0 ? (
                                        <PinsGrid
                                            pins={displayedPins}
                                            selectedIds={selectedPinIds}
                                            onSelectPin={handleSelectPin}
                                            showSelection={selectedPinIds.size > 0}
                                            onPreview={handlePreview}
                                            onDeletePin={handleDeletePin}
                                        />
                                    ) : (
                                        <div className="py-20 text-center flex flex-col items-center justify-center">
                                            <div className="h-16 w-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                                                <RefreshCw className="h-8 w-8 text-gray-400" />
                                            </div>
                                            <h3 className="text-lg font-medium text-gray-900">No pins found</h3>
                                            <p className="text-gray-500 mt-1 max-w-sm">
                                                No generated pins match the current filters. Try changing the status filter or refreshing the list.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
            </main>      {/* DB Load More Removed in favor of Server-Side Pagination */}


            {/* Bulk Selection Action Bar */}
            <SelectionActionBar
                selectedCount={selectedPinIds.size}
                totalCount={pagination.total}
                filteredCount={filteredPins.length}
                onSelectAll={handleSelectAll}
                onSelectEntireCampaign={handleSelectEntireCampaign}
                onDeselectAll={handleDeselectAll}
                onDeleteSelected={handleDeleteSelected}
                isDeleting={isDeleting}
                isEntireCampaignSelected={selectAllScope === 'all'}
            />

            {/* Delete Confirmation Modal */}
            <DeleteConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => { setShowDeleteModal(false); setPinToDelete(null); }}
                onConfirm={handleConfirmDelete}
                count={pinToDelete ? 1 : (selectAllScope === 'all' ? pagination.total : selectedPinIds.size)}
                previewImages={
                    pinToDelete
                        ? [pinToDelete.imageUrl]
                        : (selectAllScope === 'all' 
                            ? generatedPins.slice(0, 4).map(p => p.imageUrl)
                            : generatedPins.filter(p => selectedPinIds.has(p.id)).map(p => p.imageUrl))
                }
                isDeleting={isDeleting}
                deleteProgress={deleteProgress}
            />

            {/* Enhanced Preview Modal with Keyboard Navigation */}
            <PinPreviewModal
                pin={previewPin}
                pins={displayedPins}
                onClose={() => setPreviewPin(null)}
                onNavigate={setPreviewPin}
            />
        </div>
    );
}
