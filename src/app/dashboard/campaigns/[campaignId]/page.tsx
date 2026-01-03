'use client';

// Debug logging - only in development
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => DEBUG && console.log(...args);

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Loader2, Settings, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/AuthContext';
import { getCampaign, updateCampaign, CampaignWithDetails } from '@/lib/db/campaigns';
import { getTemplate } from '@/lib/db/templates';
import { supabase } from '@/lib/supabase';
import { GenerationController, GenerationSettings, GenerationProgress, DEFAULT_GENERATION_SETTINGS } from '@/components/campaign/GenerationController';
import { GenerationSettingsPanel } from '@/components/campaign/GenerationSettings';
import { PinsGrid, PinCardData } from '@/components/campaign/PinCard';
import { ExportToolbar } from '@/components/campaign/ExportToolbar';
import { CampaignDetailsPanel } from '@/components/campaign/CampaignDetailsPanel';
import { SelectionActionBar, DeleteConfirmationModal } from '@/components/ui/BulkActions';
import { Element, CanvasSize } from '@/types/editor';
import { toast } from 'sonner';

// Reusable Pagination Component
interface PaginationControlsProps {
    currentPage: number;
    totalPages: number;
    pagination: { total: number; limit: number };
    goToPageInput: string;
    setGoToPageInput: (val: string) => void;
    onPageChange: (page: number) => void;
    className?: string; // For styling tweaks (border/margin)
}

const PaginationControls: React.FC<PaginationControlsProps> = ({
    currentPage,
    totalPages,
    pagination,
    goToPageInput,
    setGoToPageInput,
    onPageChange,
    className
}) => {
    if (totalPages <= 1) return null;
    
    return (
        <div className={cn("flex items-center justify-between", className)}>
            <p className="text-sm text-gray-500">
                Showing {((currentPage - 1) * pagination.limit) + 1} to {Math.min(currentPage * pagination.limit, pagination.total)} of {pagination.total} results
            </p>
            <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 mr-2">
                    Go to page:
                    <input 
                        type="text"
                        value={goToPageInput}
                        onChange={(e) => setGoToPageInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                const p = parseInt(goToPageInput);
                                if (!isNaN(p) && p >= 1 && p <= totalPages) {
                                    onPageChange(p);
                                }
                            }
                        }}
                        className="w-12 ml-2 px-2 py-1 text-sm border border-gray-300 rounded text-center"
                    />
                </span>

                <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    Previous
                </button>
                <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        const startPage = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
                        const p = startPage + i;
                        if (p < 1 || p > totalPages) return null;
                        
                        return (
                            <button
                                key={p}
                                onClick={() => onPageChange(p)}
                                className={cn(
                                    "w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium transition-colors",
                                    currentPage === p
                                        ? "bg-blue-600 text-white"
                                        : "text-gray-600 hover:bg-gray-100"
                                )}
                            >
                                {p}
                            </button>
                        );
                    })}
                </div>
                <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    Next
                </button>
            </div>
        </div>
    );
};

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

    const [showSettings, setShowSettings] = useState(true);
    const [settings, setSettings] = useState<GenerationSettings>(() => {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem('pin-generator-settings');
                if (saved) {
                    return { ...DEFAULT_GENERATION_SETTINGS, ...JSON.parse(saved) };
                }
            } catch (e) {
                console.warn('Failed to load settings from localStorage', e);
            }
        }
        return DEFAULT_GENERATION_SETTINGS;
    });
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
        limit: Number(searchParams.get('limit')) || 20, // Default to 20 as requested
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
        const l = Number(searchParams.get('limit')) || 20;
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
            
            // Update campaign state - use functional update to verify if change is needed could be better 
            // but for now, simple set depends on React to diff objects slightly? 
            // Actually getCampaign returns new obj. 
            setCampaign(campaignData);

            // Load campaign settings if they exist and we haven't loaded them
            // (Only on first load ideally, but checks are cheap)
            if (campaignData.generation_settings) {
                const savedSettings = campaignData.generation_settings as unknown as GenerationSettings;
                if (savedSettings.batchSize && savedSettings.quality && savedSettings.pauseEnabled !== undefined) {
                    setSettings(prev => ({...prev, ...savedSettings}));
                }
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
                    .filter((pin: Record<string, unknown>) => pin.image_url)
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
    }, [campaign?.status, generatedPins.length, pagination.total, loadGeneratedPins]);

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

    // Handle progress update
    const handleProgressUpdate = useCallback(async (progress: GenerationProgress) => {
        // 🚀 OPTIMIZATION: We rely on the API (server-side) to atomically update generated_pins count
        // via the incrementally saved batches. Doing it here causes double-writes and race conditions.
        // We only use this for UI updates if needed, but the parent GenerationController handles UI local state.
        
        // if (campaign && progress.current % 5 === 0) {
        //     await updateCampaign(campaign.id, {
        //         generated_pins: progress.current,
        //         current_index: progress.current,
        //     });
        // }
    }, []);

    // Handle status change
    const handleStatusChange = useCallback(async (status: string) => {
        if (campaign) {
            log('[CampaignPage] Updating status to:', status, 'for campaign:', campaign.id);
            const updateData: Record<string, unknown> = { status };
            if (status === 'paused') {
                updateData.paused_at = new Date().toISOString();
            } else if (status === 'completed') {
                updateData.completed_at = new Date().toISOString();
            }
            const success = await updateCampaign(campaign.id, updateData);
            log('[CampaignPage] Update result:', success);
            if (success) {
                setCampaign((prev) => prev ? { ...prev, status: status as 'pending' | 'processing' | 'paused' | 'completed' | 'failed' } : null);
            }
        }
    }, [campaign]);

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
            {/* Header */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/dashboard/campaigns"
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5 text-gray-600" />
                        </Link>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">{campaign.name}</h1>
                            <p className="text-sm text-gray-500">
                                {csvData.length} pins • {campaign.status}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors",
                            showSettings
                                ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        )}
                    >
                        <Settings className="w-4 h-4" />
                        Settings
                    </button>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Column: Info & Settings */}
                    <div className="space-y-6">
                        {/* Campaign Details Panel */}
                        <CampaignDetailsPanel
                            campaignName={campaign.name}
                            templateName={templateData?.name}
                            templateThumbnail={templateData?.thumbnail_url || undefined}
                            canvasWidth={template?.canvas_size.width}
                            canvasHeight={template?.canvas_size.height}
                            templateId={campaign.template_id}
                            csvRowCount={csvData.length}
                            createdAt={campaign.created_at}
                            status={campaign.status}
                            generatedCount={Math.max(generatedPins.length, pagination.total)}
                        />

                        {/* Settings Panel */}
                        {showSettings && (
                            <GenerationSettingsPanel
                                settings={settings}
                                onChange={setSettings}
                                disabled={campaign.status === 'processing'}
                            />
                        )}
                    </div>

                    {/* Right Column: Generation & Pins */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Generation Controller */}
                        <GenerationController
                            campaignId={campaign.id}
                            userId={currentUser?.id || ''}
                            templateElements={template.elements}
                            canvasSize={template.canvas_size}
                            backgroundColor={template.background_color}
                            // Multi-template props
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
                        />

                        <div className="flex justify-end items-center gap-3">
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-500">Show:</span>
                                <select
                                    value={pagination.limit}
                                    onChange={(e) => {
                                        const newLimit = Number(e.target.value);
                                        // Reset to page 1 when limit changes to avoid out of bounds
                                        updateUrl(1, newLimit, sortBy);
                                        loadGeneratedPins(1, newLimit, sortBy);
                                    }}
                                    className="text-sm border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 py-1.5"
                                >
                                    {[10, 20, 30, 50, 100].map(size => (
                                        <option key={size} value={size}>{size} per page</option>
                                    ))}
                                </select>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-500">Sort:</span>
                                <select
                                    value={sortBy}
                                    onChange={(e) => {
                                        const newSort = e.target.value;
                                        setSortBy(newSort);
                                        // Reset to page 1 on sort change usually makes sense
                                        updateUrl(1, pagination.limit, newSort);
                                        loadGeneratedPins(1, pagination.limit, newSort);
                                    }}
                                    className="text-sm border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 py-1.5"
                                >
                                    <option value="created_at_desc">Newest First</option>
                                    <option value="created_at_asc">Oldest First</option>
                                    {/* <option value="index_asc">CSV Row Order</option> */ /* Waiting for backend support for JSON sorting */}
                                </select>
                            </div>
                            <button
                                onClick={() => loadGeneratedPins(currentPage, pagination.limit, sortBy)}
                                disabled={pagination.isLoading}
                                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                                title="Refresh list from server"
                            >
                                <RefreshCw className={`w-4 h-4 ${pagination.isLoading ? 'animate-spin' : ''}`} />
                                Refresh List
                            </button>
                        </div>

                        {/* Export Toolbar */}
                        {generatedPins.length > 0 && (
                            <ExportToolbar
                                pins={generatedPins}
                                campaignName={campaign.name}
                                csvData={csvData}
                                totalCount={pagination.total}
                                isEntireCampaignSelected={selectAllScope === 'all'}
                            />
                        )}

                        {/* Pins Grid with Filter Tabs and Pagination */}
                        {generatedPins.length > 0 && (
                            <div className="bg-white border border-gray-200 rounded-xl p-6">
                                <div className="flex flex-col gap-6 mb-6">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-semibold text-gray-900">
                                            Generated Pins
                                        </h3>
                                        {selectedPinIds.size > 0 && (
                                            <span className="text-sm text-blue-600 font-medium">
                                                {selectedPinIds.size} selected
                                            </span>
                                        )}
                                    </div>
                                    
                                    {/* Filter Tabs */}
                                    <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-lg w-fit">
                                        <button
                                            onClick={() => setFilterStatus('all')}
                                            className={cn(
                                                "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                                                filterStatus === 'all'
                                                    ? "bg-white text-gray-900 shadow-sm"
                                                    : "text-gray-500 hover:text-gray-700"
                                            )}
                                        >
                                            All <span className="ml-1 text-xs opacity-60">({counts.all})</span>
                                        </button>
                                        <button
                                            onClick={() => setFilterStatus('completed')}
                                            className={cn(
                                                "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                                                filterStatus === 'completed'
                                                    ? "bg-white text-green-700 shadow-sm"
                                                    : "text-gray-500 hover:text-gray-700"
                                            )}
                                        >
                                            Success <span className="ml-1 text-xs opacity-60">({counts.completed})</span>
                                        </button>
                                        <button
                                            onClick={() => setFilterStatus('failed')}
                                            className={cn(
                                                "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                                                filterStatus === 'failed'
                                                    ? "bg-white text-red-700 shadow-sm"
                                                    : "text-gray-500 hover:text-gray-700"
                                            )}
                                        >
                                            Failed 
                                            {counts.failed > 0 && (
                                                <span className="ml-2 px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-bold">
                                                    {counts.failed}
                                                </span>
                                            )}
                                        </button>
                                    </div>
                                </div>


                                {displayedPins.length > 0 ? (
                                    <>
                                        {/* Pagination Controls - Above */}
                                        <PaginationControls
                                            currentPage={currentPage}
                                            totalPages={totalPages}
                                            pagination={pagination}
                                            goToPageInput={goToPageInput}
                                            setGoToPageInput={setGoToPageInput}
                                            onPageChange={(p) => {
                                                updateUrl(p, pagination.limit, sortBy);
                                                loadGeneratedPins(p, pagination.limit, sortBy);
                                            }}
                                            className="mb-6 pb-6 border-b border-gray-100"
                                        />

                                        <PinsGrid
                                            pins={displayedPins}
                                            selectedIds={selectedPinIds}
                                            onSelectPin={handleSelectPin}
                                            showSelection={selectedPinIds.size > 0}
                                            onPreview={handlePreview}
                                            onDeletePin={handleDeletePin}
                                        />
                                        
                                        {/* Pagination Controls - Below */}
                                        <PaginationControls
                                            currentPage={currentPage}
                                            totalPages={totalPages}
                                            pagination={pagination}
                                            goToPageInput={goToPageInput}
                                            setGoToPageInput={setGoToPageInput}
                                            onPageChange={(p) => {
                                                updateUrl(p, pagination.limit, sortBy);
                                                loadGeneratedPins(p, pagination.limit, sortBy);
                                            }}
                                            className="mt-6 pt-6 border-t border-gray-100"
                                        />
                                    </>
                                ) : (
                                    <div className="py-12 text-center">
                                        <p className="text-gray-500">No pins found matching this filter.</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* DB Load More Removed in favor of Server-Side Pagination */}
            </main>

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

            {/* Preview Modal */}
            {previewPin && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
                    onClick={() => setPreviewPin(null)}
                >
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                         <Image
                            src={previewPin.imageUrl}
                            alt={`Pin ${previewPin.rowIndex + 1}`}
                            width={1000}
                            height={1500}
                            className="max-w-full max-h-[90vh] w-auto h-auto rounded-lg shadow-2xl"
                            unoptimized
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
