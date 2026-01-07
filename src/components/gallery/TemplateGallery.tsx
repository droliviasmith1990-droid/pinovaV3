/**
 * Template Gallery (Enhanced)
 * 
 * Full-featured template discovery with:
 * - Category filtering
 * - Tag filtering (multi-select)
 * - Search by name/description
 * - Featured badge
 * - Tab navigation (All, My Templates, Featured)
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Loader2, Layout, X, Search, Filter, Star, Tag, Check,
    Folder, ChevronDown, RefreshCw, SlidersHorizontal, LucideIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { getTemplatesFiltered, getTemplate, TemplateListItem, TemplateFilters } from '@/lib/db/templates';
import { preloadTemplateFonts } from '@/lib/fonts/fontLoader';
import { useEditorStore } from '@/stores/editorStore';
import { useCategoryStore } from '@/stores/categoryStore';
import { useTagStore } from '@/stores/tagStore';
import { isSupabaseConfigured } from '@/lib/supabase';
import { generateId } from '@/lib/utils';
import { DbCategory, DbTag } from '@/types/database.types';
import { getCacheBustedThumbnailUrl } from '@/lib/utils/thumbnailUrl';

// Import all Lucide icons for dynamic category icons
import * as LucideIcons from 'lucide-react';

interface TemplateGalleryProps {
    isOpen: boolean;
    onClose: () => void;
}

// Tab types for gallery navigation
type GalleryTab = 'all' | 'my-templates' | 'featured';

// Sort options
type SortOption = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'popular';

// ============================================
// Helper Functions
// ============================================

function getIconComponent(iconName: string | null): LucideIcon {
    if (!iconName) return Folder;
    const pascalCase = iconName.replace(/(^|-)([a-z])/g, (_, __, char) => char.toUpperCase());
    const icons = LucideIcons as unknown as Record<string, LucideIcon | undefined>;
    return icons[pascalCase] || Folder;
}

// Demo templates for when database is not configured
const demoGalleryTemplates: TemplateListItem[] = [
    { id: 'demo-1', short_id: 'demo-1', name: 'Recipe Card', thumbnail_url: null, category: 'Food', category_id: null, is_featured: true, view_count: 120, created_at: '', updated_at: '' },
    { id: 'demo-2', short_id: 'demo-2', name: 'Inspirational Quote', thumbnail_url: null, category: 'Quote', category_id: null, is_featured: false, view_count: 85, created_at: '', updated_at: '' },
    { id: 'demo-3', short_id: 'demo-3', name: 'Product Showcase', thumbnail_url: null, category: 'Product', category_id: null, is_featured: true, view_count: 200, created_at: '', updated_at: '' },
    { id: 'demo-4', short_id: 'demo-4', name: 'Stats Infographic', thumbnail_url: null, category: 'Infographic', category_id: null, is_featured: false, view_count: 50, created_at: '', updated_at: '' },
];

// ============================================
// Template Card Component
// ============================================

interface TemplateCardProps {
    template: TemplateListItem;
    onUse: (template: TemplateListItem) => void;
    isLoading: boolean;
    categories: DbCategory[];
}

function TemplateCard({ template, onUse, isLoading, categories }: TemplateCardProps) {
    const category = template.category_id
        ? categories.find(c => c.id === template.category_id)
        : null;

    const CategoryIcon = category ? getIconComponent(category.icon) : null;

    return (
        <div className="group relative bg-white rounded-xl border-2 border-gray-200 overflow-hidden hover:border-blue-500 hover:shadow-xl transition-all duration-200">
            {/* Thumbnail */}
            <div className="aspect-2/3 bg-gradient-to-br from-pink-400 via-purple-400 to-blue-500 relative">
                {template.thumbnail_url ? (
                    <img
                        src={getCacheBustedThumbnailUrl(template.thumbnail_url, template.updated_at) || template.thumbnail_url}
                        alt={template.name}
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Layout className="w-12 h-12 text-white/50" />
                    </div>
                )}

                {/* Featured Badge */}
                {template.is_featured && (
                    <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-amber-500 text-white text-xs font-medium rounded-full shadow-lg">
                        <Star className="w-3 h-3 fill-current" />
                        Featured
                    </div>
                )}

                {/* Category Badge */}
                {category && (
                    <div
                        className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full shadow-lg"
                        style={{
                            backgroundColor: `${category.color || '#6b7280'}`,
                            color: 'white',
                        }}
                    >
                        {CategoryIcon && <CategoryIcon className="w-3 h-3" />}
                        {category.name}
                    </div>
                )}

                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button
                        onClick={() => onUse(template)}
                        disabled={isLoading}
                        className={cn(
                            "px-6 py-2.5 bg-white text-gray-900 rounded-lg font-medium text-sm",
                            "hover:bg-blue-600 hover:text-white transition-colors",
                            "flex items-center gap-2",
                            isLoading && "opacity-50 cursor-not-allowed"
                        )}
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Loading...
                            </>
                        ) : (
                            'Use Template'
                        )}
                    </button>
                </div>
            </div>

            {/* Info */}
            <div className="p-3">
                <p className="font-medium text-gray-900 truncate">{template.name}</p>
                <div className="flex items-center justify-between mt-1">
                    {/* Tags preview */}
                    {template.tags && template.tags.length > 0 ? (
                        <div className="flex items-center gap-1 flex-wrap">
                            {template.tags.slice(0, 2).map((tag) => (
                                <span
                                    key={tag.id}
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded"
                                >
                                    <Tag className="w-2.5 h-2.5" />
                                    {tag.name}
                                </span>
                            ))}
                            {template.tags.length > 2 && (
                                <span className="text-xs text-gray-400">
                                    +{template.tags.length - 2}
                                </span>
                            )}
                        </div>
                    ) : (
                        <span className="text-xs text-gray-400">No tags</span>
                    )}
                    {/* View count */}
                    <span className="text-xs text-gray-400">{template.view_count} views</span>
                </div>
            </div>
        </div>
    );
}

// ============================================
// Main Gallery Component
// ============================================

export function TemplateGallery({ isOpen, onClose }: TemplateGalleryProps) {
    const loadTemplate = useEditorStore((s) => s.loadTemplate);
    const { categories, fetchCategories, hasFetched: categoriesFetched } = useCategoryStore();
    const { tags, fetchTags, hasFetched: tagsFetched } = useTagStore();

    // State
    const [templates, setTemplates] = useState<TemplateListItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingTemplate, setIsLoadingTemplate] = useState<string | null>(null);

    // Tab navigation
    const [activeTab, setActiveTab] = useState<GalleryTab>('all');

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
    const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
    const [showFilters, setShowFilters] = useState(false);
    const [sortBy, setSortBy] = useState<SortOption>('newest');

    // Fetch categories and tags on mount
    useEffect(() => {
        if (isOpen) {
            if (!categoriesFetched) fetchCategories(true);
            if (!tagsFetched) fetchTags(true);
        }
    }, [isOpen, categoriesFetched, tagsFetched, fetchCategories, fetchTags]);

    // Build filters object
    const filters = useMemo<TemplateFilters>(() => {
        const f: TemplateFilters = {};

        if (selectedCategoryId) f.categoryId = selectedCategoryId;
        if (selectedTagIds.length > 0) f.tagIds = selectedTagIds;
        if (searchQuery.trim()) f.search = searchQuery.trim();
        if (activeTab === 'featured') f.isFeatured = true;

        return f;
    }, [selectedCategoryId, selectedTagIds, searchQuery, activeTab]);

    // Fetch templates
    const fetchTemplates = useCallback(async () => {
        if (!isSupabaseConfigured()) {
            setTemplates(demoGalleryTemplates);
            return;
        }

        setIsLoading(true);
        try {
            const results = await getTemplatesFiltered(filters);
            setTemplates(results.length > 0 ? results : []);
        } catch (error) {
            console.error('Error fetching templates:', error);
            setTemplates(demoGalleryTemplates);
        } finally {
            setIsLoading(false);
        }
    }, [filters]);

    // Fetch when opened or filters change
    useEffect(() => {
        if (isOpen) {
            fetchTemplates();
        }
    }, [isOpen, fetchTemplates]);

    // Sort templates
    const sortedTemplates = useMemo(() => {
        const sorted = [...templates];
        switch (sortBy) {
            case 'newest':
                sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                break;
            case 'oldest':
                sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                break;
            case 'name-asc':
                sorted.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'name-desc':
                sorted.sort((a, b) => b.name.localeCompare(a.name));
                break;
            case 'popular':
                sorted.sort((a, b) => b.view_count - a.view_count);
                break;
        }
        return sorted;
    }, [templates, sortBy]);

    // Active filters count
    const activeFiltersCount = useMemo(() => {
        let count = 0;
        if (selectedCategoryId) count++;
        count += selectedTagIds.length;
        if (searchQuery.trim()) count++;
        return count;
    }, [selectedCategoryId, selectedTagIds, searchQuery]);

    // Clear all filters
    const clearFilters = () => {
        setSearchQuery('');
        setSelectedCategoryId(null);
        setSelectedTagIds([]);
    };

    // Toggle tag selection
    const toggleTag = (tagId: string) => {
        setSelectedTagIds(prev =>
            prev.includes(tagId)
                ? prev.filter(id => id !== tagId)
                : [...prev, tagId]
        );
    };

    // Handle "Use Template" click
    const handleUseTemplate = async (template: TemplateListItem) => {
        setIsLoadingTemplate(template.id);

        try {
            const fullTemplate = await getTemplate(template.id);

            if (fullTemplate) {
                // Preload custom fonts before rendering
                if (fullTemplate.elements && Array.isArray(fullTemplate.elements)) {
                    await preloadTemplateFonts(fullTemplate.elements);
                }
                
                loadTemplate({
                    id: generateId(),
                    name: `${fullTemplate.name} (Copy)`,
                    elements: fullTemplate.elements,
                    background_color: fullTemplate.background_color,
                    canvas_size: fullTemplate.canvas_size,
                });
                toast.success(`Loaded "${template.name}" as a new template`);
            } else {
                loadTemplate({
                    id: generateId(),
                    name: `${template.name} (Copy)`,
                    elements: [],
                    background_color: '#FFFFFF',
                });
                toast.info(`Created "${template.name}" template (demo)`);
            }

            onClose();
        } catch (error) {
            console.error('Error loading template:', error);
            toast.error('Failed to load template');
        } finally {
            setIsLoadingTemplate(null);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col m-4">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Template Gallery</h2>
                        <p className="text-sm text-gray-500">Choose a template to get started quickly</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tab Navigation */}
                <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-4">
                    <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
                        <button
                            onClick={() => setActiveTab('all')}
                            className={cn(
                                "px-4 py-2 rounded-md text-sm font-medium transition-all",
                                activeTab === 'all'
                                    ? "bg-white text-gray-900 shadow-sm"
                                    : "text-gray-600 hover:text-gray-900"
                            )}
                        >
                            All Templates
                        </button>
                        <button
                            onClick={() => setActiveTab('featured')}
                            className={cn(
                                "px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-1.5",
                                activeTab === 'featured'
                                    ? "bg-white text-gray-900 shadow-sm"
                                    : "text-gray-600 hover:text-gray-900"
                            )}
                        >
                            <Star className="w-4 h-4 text-amber-500" />
                            Featured
                        </button>
                    </div>

                    <div className="flex-1" />

                    {/* Search */}
                    <div className="relative w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search templates..."
                            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>

                    {/* Filter Toggle */}
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all",
                            showFilters || activeFiltersCount > 0
                                ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        )}
                    >
                        <SlidersHorizontal className="w-4 h-4" />
                        Filters
                        {activeFiltersCount > 0 && (
                            <span className="px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded-full">
                                {activeFiltersCount}
                            </span>
                        )}
                    </button>

                    {/* Sort */}
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as SortOption)}
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                        <option value="newest">Newest First</option>
                        <option value="oldest">Oldest First</option>
                        <option value="name-asc">Name A-Z</option>
                        <option value="name-desc">Name Z-A</option>
                        <option value="popular">Most Popular</option>
                    </select>

                    {/* Refresh */}
                    <button
                        onClick={fetchTemplates}
                        disabled={isLoading}
                        className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={cn("w-5 h-5", isLoading && "animate-spin")} />
                    </button>
                </div>

                {/* Filter Panel */}
                {showFilters && (
                    <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-medium text-gray-900">Filter Templates</h3>
                            {activeFiltersCount > 0 && (
                                <button
                                    onClick={clearFilters}
                                    className="text-sm text-blue-600 hover:underline"
                                >
                                    Clear all filters
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            {/* Category Filter */}
                            <div>
                                <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-2">
                                    Category
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => setSelectedCategoryId(null)}
                                        className={cn(
                                            "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all",
                                            selectedCategoryId === null
                                                ? "bg-blue-600 text-white"
                                                : "bg-white border border-gray-300 text-gray-700 hover:border-blue-500"
                                        )}
                                    >
                                        <Folder className="w-3.5 h-3.5" />
                                        All
                                    </button>
                                    {categories.map((cat) => {
                                        const Icon = getIconComponent(cat.icon);
                                        const isSelected = selectedCategoryId === cat.id;
                                        return (
                                            <button
                                                key={cat.id}
                                                onClick={() => setSelectedCategoryId(isSelected ? null : cat.id)}
                                                className={cn(
                                                    "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all",
                                                    isSelected
                                                        ? "text-white"
                                                        : "bg-white border border-gray-300 text-gray-700 hover:border-blue-500"
                                                )}
                                                style={isSelected ? { backgroundColor: cat.color || '#3b82f6' } : undefined}
                                            >
                                                <Icon className="w-3.5 h-3.5" />
                                                {cat.name}
                                                {cat.template_count !== undefined && (
                                                    <span className={cn(
                                                        "text-xs",
                                                        isSelected ? "opacity-80" : "text-gray-400"
                                                    )}>
                                                        ({cat.template_count})
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Tag Filter */}
                            <div>
                                <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-2">
                                    Tags
                                </label>
                                <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                                    {tags.slice(0, 20).map((tag) => {
                                        const isSelected = selectedTagIds.includes(tag.id);
                                        return (
                                            <button
                                                key={tag.id}
                                                onClick={() => toggleTag(tag.id)}
                                                className={cn(
                                                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all",
                                                    isSelected
                                                        ? "bg-blue-600 text-white"
                                                        : "bg-white border border-gray-300 text-gray-600 hover:border-blue-500"
                                                )}
                                            >
                                                {isSelected ? (
                                                    <Check className="w-3 h-3" />
                                                ) : (
                                                    <Tag className="w-3 h-3" />
                                                )}
                                                {tag.name}
                                            </button>
                                        );
                                    })}
                                    {tags.length > 20 && (
                                        <span className="text-xs text-gray-400 py-1">
                                            +{tags.length - 20} more
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Active Filters Display */}
                        {activeFiltersCount > 0 && (
                            <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                                <span className="text-xs text-gray-500">Active:</span>
                                {selectedCategoryId && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                                        {categories.find(c => c.id === selectedCategoryId)?.name}
                                        <button onClick={() => setSelectedCategoryId(null)}>
                                            <X className="w-3 h-3" />
                                        </button>
                                    </span>
                                )}
                                {selectedTagIds.map(tagId => {
                                    const tag = tags.find(t => t.id === tagId);
                                    return tag ? (
                                        <span
                                            key={tagId}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full"
                                        >
                                            {tag.name}
                                            <button onClick={() => toggleTag(tagId)}>
                                                <X className="w-3 h-3" />
                                            </button>
                                        </span>
                                    ) : null;
                                })}
                                {searchQuery && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                                        &quot;{searchQuery}&quot;
                                        <button onClick={() => setSearchQuery('')}>
                                            <X className="w-3 h-3" />
                                        </button>
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Template Grid */}
                <div className="flex-1 overflow-y-auto p-6">
                    {isLoading ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {[...Array(8)].map((_, i) => (
                                <div key={i} className="animate-pulse">
                                    <div className="aspect-2/3 bg-gray-200 rounded-xl" />
                                    <div className="p-3 space-y-2">
                                        <div className="h-4 bg-gray-200 rounded w-3/4" />
                                        <div className="h-3 bg-gray-200 rounded w-1/2" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : sortedTemplates.length === 0 ? (
                        <div className="text-center py-16">
                            <Layout className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                            <h3 className="text-lg font-medium text-gray-900 mb-2">No templates found</h3>
                            <p className="text-gray-500 mb-4">
                                {activeFiltersCount > 0
                                    ? "Try adjusting your filters or search terms"
                                    : "No templates available yet"}
                            </p>
                            {activeFiltersCount > 0 && (
                                <button
                                    onClick={clearFilters}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                    Clear all filters
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {sortedTemplates.map((template) => (
                                <TemplateCard
                                    key={template.id}
                                    template={template}
                                    onUse={handleUseTemplate}
                                    isLoading={isLoadingTemplate === template.id}
                                    categories={categories}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
                    <span className="text-sm text-gray-500">
                        {sortedTemplates.length} template{sortedTemplates.length !== 1 ? 's' : ''}
                        {activeFiltersCount > 0 && ' (filtered)'}
                    </span>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Filter className="w-4 h-4" />
                        {categories.length} categories, {tags.length} tags available
                    </div>
                </div>
            </div>
        </div>
    );
}
