'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { TemplateListItem, deleteTemplate, duplicateTemplate, updateTemplateMetadata } from '@/lib/db/templates';
import { useTemplatesWithElements } from '@/hooks/useTemplates';
import { extractDynamicData, DynamicDataSummary, DynamicDataFilter, matchesDynamicDataFilter } from '@/lib/utils/extractDynamicData';

import { TemplateToolbar, ViewMode } from './TemplateToolbar';
import { TemplateGrid } from './TemplateGrid';
import { ScalableFilterSidebar } from '@/components/shared/ScalableFilterSidebar';
import { BulkActionToolbar } from './BulkActionToolbar';
import { QuickEditModal } from './QuickEditModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';

export function TemplatesPageContainer() {
    const router = useRouter();
    
    // Filter state
    const [searchQuery, setSearchQuery] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
    const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
    const [isFeatured, setIsFeatured] = useState(false);
    const [dynamicDataFilter, setDynamicDataFilter] = useState<DynamicDataFilter | null>(null);
    
    // View state
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    
    // Selection state
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    
    // Modal state
    const [quickEditTemplate, setQuickEditTemplate] = useState<TemplateListItem | null>(null);
    const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [bulkDeleteMode, setBulkDeleteMode] = useState(false);

    // React Query Filters
    const filters = useMemo(() => ({
        categoryId: selectedCategoryId || undefined,
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        search: searchQuery || undefined,
        isFeatured: isFeatured || undefined,
    }), [selectedCategoryId, selectedTagIds, searchQuery, isFeatured]);

    // Data Fetching with Caching
    const { data: templates = [], isLoading, invalidateAndRefetch } = useTemplatesWithElements(filters);
    
    // Derived State: Dynamic Data Map
    const dynamicDataMap = useMemo(() => {
        const dataMap = new Map<string, DynamicDataSummary>();
        for (const template of templates) {
            const summary = extractDynamicData(template.elements || []);
            dataMap.set(template.id, summary);
        }
        return dataMap;
    }, [templates]);

    // Use invalidateAndRefetch for manual refresh (bypasses cache)
    const handleRefresh = useCallback(async () => {
        await invalidateAndRefetch();
        toast.success('Templates refreshed');
    }, [invalidateAndRefetch]);
    
    // Alias for backward compatibility
    const fetchTemplates = handleRefresh;
    
    // Load view preference from localStorage
    useEffect(() => {
        const savedViewMode = localStorage.getItem('template_view_mode');
        if (savedViewMode === 'grid' || savedViewMode === 'list') {
            setViewMode(savedViewMode);
        }
    }, []);
    
    // Apply dynamic data filter client-side
    const filteredTemplates = useMemo(() => {
        if (!dynamicDataFilter) return templates;
        
        return templates.filter(template => {
            const dynamicData = dynamicDataMap.get(template.id);
            if (!dynamicData) return false;
            return matchesDynamicDataFilter(dynamicData, dynamicDataFilter);
        });
    }, [templates, dynamicDataMap, dynamicDataFilter]);
    
    // Count active filters
    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (selectedCategoryId) count++;
        if (selectedTagIds.length > 0) count++;
        if (isFeatured) count++;
        if (dynamicDataFilter) count++;
        return count;
    }, [selectedCategoryId, selectedTagIds, isFeatured, dynamicDataFilter]);
    
    // Clear all filters
    const clearAllFilters = useCallback(() => {
        setSearchQuery('');
        setSelectedCategoryId(null);
        setSelectedTagIds([]);
        setIsFeatured(false);
        setDynamicDataFilter(null);
    }, []);
    
    // Selection handlers
    const handleSelect = useCallback((id: string, selected: boolean) => {
        setSelectedIds(prev => 
            selected 
                ? [...prev, id]
                : prev.filter(i => i !== id)
        );
    }, []);
    
    const handleSelectAll = useCallback(() => {
        setSelectedIds(filteredTemplates.map(t => t.id));
    }, [filteredTemplates]);
    
    const handleClearSelection = useCallback(() => {
        setSelectedIds([]);
    }, []);
    
    // Action handlers
    const handleDuplicate = useCallback(async (id: string) => {
        try {
            const duplicated = await duplicateTemplate(id);
            if (duplicated) {
                toast.success('Template duplicated successfully');
                fetchTemplates(); // Refresh
            } else {
                toast.error('Failed to duplicate template');
            }
        } catch (error) {
            console.error('Error duplicating template:', error);
            toast.error('An error occurred');
        }
    }, [fetchTemplates]);
    
    const handleDelete = useCallback(async () => {
        if (bulkDeleteMode) {
            // Bulk delete
            setIsDeleting(true);
            try {
                let successCount = 0;
                for (const id of selectedIds) {
                    const success = await deleteTemplate(id);
                    if (success) successCount++;
                }
                toast.success(`Deleted ${successCount} template${successCount !== 1 ? 's' : ''}`);
                setSelectedIds([]);
                fetchTemplates();
            } catch (error) {
                console.error('Error deleting templates:', error);
                toast.error('An error occurred');
            } finally {
                setIsDeleting(false);
                setDeleteTemplateId(null);
                setBulkDeleteMode(false);
            }
        } else if (deleteTemplateId) {
            // Single delete
            setIsDeleting(true);
            try {
                const success = await deleteTemplate(deleteTemplateId);
                if (success) {
                    toast.success('Template deleted');
                    fetchTemplates();
                } else {
                    toast.error('Failed to delete template');
                }
            } catch (error) {
                console.error('Error deleting template:', error);
                toast.error('An error occurred');
            } finally {
                setIsDeleting(false);
                setDeleteTemplateId(null);
            }
        }
    }, [deleteTemplateId, bulkDeleteMode, selectedIds, fetchTemplates]);
    
    const handleGenerate = useCallback((id: string) => {
        router.push(`/dashboard/campaigns/new?templateId=${id}`);
    }, [router]);
    
    // Bulk action handlers
    const handleBulkGenerate = useCallback(() => {
        if (selectedIds.length === 0) return;
        router.push(`/dashboard/campaigns/new?templateIds=${selectedIds.join(',')}`);
    }, [selectedIds, router]);
    
    const handleBulkDelete = useCallback(() => {
        setBulkDeleteMode(true);
        setDeleteTemplateId('bulk'); // Trigger modal
    }, []);
    
    const handleBulkSetCategory = useCallback(async () => {
        // TODO: Implement modal for category selection
        toast.info('Category selection coming soon');
    }, []);
    
    const handleBulkAddTags = useCallback(async () => {
        // TODO: Implement modal for tag selection
        toast.info('Tag selection coming soon');
    }, []);
    
    const handleBulkToggleFeatured = useCallback(async () => {
        try {
            let updated = 0;
            for (const id of selectedIds) {
                const template = templates.find(t => t.id === id);
                if (template) {
                    const success = await updateTemplateMetadata(id, {
                        isFeatured: !template.is_featured,
                    });
                    if (success) updated++;
                }
            }
            toast.success(`Updated ${updated} template${updated !== 1 ? 's' : ''}`);
            fetchTemplates();
        } catch (error) {
            console.error('Error updating templates:', error);
            toast.error('An error occurred');
        }
    }, [selectedIds, templates, fetchTemplates]);
    
    return (
        <div className="space-y-6">
            {/* Bulk Action Toolbar */}
            <BulkActionToolbar
                selectedCount={selectedIds.length}
                onBulkDelete={handleBulkDelete}
                onBulkGenerate={handleBulkGenerate}
                onBulkSetCategory={handleBulkSetCategory}
                onBulkAddTags={handleBulkAddTags}
                onBulkToggleFeatured={handleBulkToggleFeatured}
                onClearSelection={handleClearSelection}
            />
            
            {/* Toolbar */}
            <TemplateToolbar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                showFilters={showFilters}
                onToggleFilters={() => setShowFilters(!showFilters)}
                activeFilterCount={activeFilterCount}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onRefresh={fetchTemplates}
                isLoading={isLoading}
                totalCount={filteredTemplates.length}
                selectedCount={selectedIds.length}
                onSelectAll={handleSelectAll}
                onClearSelection={handleClearSelection}
            />
            
            {/* Main Content: Sidebar + Grid */}
            <div className="flex gap-6">
                {/* Filter Sidebar */}
                <ScalableFilterSidebar
                    isOpen={showFilters}
                    selectedCategoryId={selectedCategoryId}
                    onCategoryChange={setSelectedCategoryId}
                    selectedTagIds={selectedTagIds}
                    onTagsChange={setSelectedTagIds}
                    isFeatured={isFeatured}
                    onFeaturedChange={setIsFeatured}
                    dynamicDataFilter={dynamicDataFilter}
                    onDynamicDataFilterChange={setDynamicDataFilter}
                    onClearAll={clearAllFilters}
                    showDynamicData={true}
                />

                {/* Template Grid */}
                <div className="flex-1 min-w-0">
                    <TemplateGrid
                        templates={filteredTemplates}
                        dynamicDataMap={dynamicDataMap}
                        selectedIds={selectedIds}
                        onSelect={handleSelect}
                        onQuickEdit={setQuickEditTemplate}
                        onDuplicate={handleDuplicate}
                        onDelete={(id) => setDeleteTemplateId(id)}
                        onGenerate={handleGenerate}
                        viewMode={viewMode}
                        isLoading={isLoading}
                        hasFilters={activeFilterCount > 0 || !!searchQuery}
                        onClearFilters={clearAllFilters}
                    />
                </div>
            </div>
            
            {/* Quick Edit Modal */}
            <QuickEditModal
                template={quickEditTemplate}
                isOpen={!!quickEditTemplate}
                onClose={() => setQuickEditTemplate(null)}
                onSave={fetchTemplates}
            />
            
            {/* Delete Confirm Modal */}
            <DeleteConfirmModal
                isOpen={!!deleteTemplateId}
                title={bulkDeleteMode ? 'Delete Templates' : 'Delete Template'}
                message={bulkDeleteMode 
                    ? `Are you sure you want to delete ${selectedIds.length} template${selectedIds.length !== 1 ? 's' : ''}?`
                    : 'Are you sure you want to delete this template?'
                }
                itemCount={bulkDeleteMode ? selectedIds.length : 1}
                isDeleting={isDeleting}
                onConfirm={handleDelete}
                onCancel={() => {
                    setDeleteTemplateId(null);
                    setBulkDeleteMode(false);
                }}
            />
        </div>
    );
}
