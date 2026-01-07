'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Plus, FileQuestion, Edit, Copy, Trash2, Rocket, Star, ImageIcon, Type, MoreVertical, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TemplateListItem } from '@/lib/db/templates';
import { DynamicDataSummary } from '@/lib/utils/extractDynamicData';
import { TemplateCard } from './TemplateCard';
import { ViewMode } from './TemplateToolbar';
import { getCacheBustedThumbnailUrl } from '@/lib/utils/thumbnailUrl';

interface TemplateGridProps {
    templates: TemplateListItem[];
    dynamicDataMap: Map<string, DynamicDataSummary>;
    selectedIds: string[];
    onSelect: (id: string, selected: boolean) => void;
    onQuickEdit: (template: TemplateListItem) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    onGenerate: (id: string) => void;
    viewMode: ViewMode;
    isLoading: boolean;
    hasFilters: boolean;
    onClearFilters: () => void;
}

// Skeleton card for loading state
function SkeletonCard() {
    return (
        <div className="flex flex-col gap-3">
            <div className="aspect-[3/4] rounded-xl bg-gray-200 animate-pulse" />
            <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-gray-200 rounded animate-pulse w-1/2" />
            </div>
        </div>
    );
}

// Skeleton row for list view loading state
function SkeletonRow() {
    return (
        <div className="flex items-center gap-4 p-3 bg-white border border-gray-200 rounded-lg">
            <div className="w-12 h-12 bg-gray-200 rounded animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded animate-pulse w-1/3" />
                <div className="h-3 bg-gray-200 rounded animate-pulse w-1/4" />
            </div>
        </div>
    );
}

// List view row component
function TemplateRow({
    template,
    dynamicData,
    isSelected,
    onSelect,
    onQuickEdit,
    onDuplicate,
    onDelete,
    onGenerate,
}: {
    template: TemplateListItem;
    dynamicData?: DynamicDataSummary;
    isSelected: boolean;
    onSelect: (id: string, selected: boolean) => void;
    onQuickEdit: (template: TemplateListItem) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    onGenerate: (id: string) => void;
}) {
    const [showMenu, setShowMenu] = React.useState(false);

    return (
        <div className={cn(
            "flex items-center gap-4 p-3 bg-white border rounded-lg transition-all hover:shadow-md",
            isSelected ? "border-blue-500 bg-blue-50" : "border-gray-200"
        )}>
            {/* Checkbox */}
            <div
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect(template.id, !isSelected);
                }}
                className={cn(
                    "w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer shrink-0",
                    isSelected
                        ? "bg-blue-500 border-blue-500 text-white"
                        : "border-gray-300 hover:border-blue-400"
                )}
            >
                {isSelected && (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                )}
            </div>

            {/* Thumbnail */}
            <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-200 shrink-0 relative">
                {template.thumbnail_url ? (
                    <Image
                        src={getCacheBustedThumbnailUrl(template.thumbnail_url, template.updated_at) || template.thumbnail_url}
                        alt={template.name}
                        fill
                        className="object-cover"
                        sizes="48px"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-300" />
                )}
            </div>

            {/* Name & Category */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-gray-900 truncate">{template.name}</h3>
                    {template.is_featured && (
                        <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />
                    )}
                </div>
                {template.category_data && (
                    <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        {template.category_data.icon && <span>{template.category_data.icon}</span>}
                        {template.category_data.name}
                    </p>
                )}
            </div>

            {/* Dynamic Data */}
            <div className="hidden sm:flex items-center gap-2 shrink-0">
                {dynamicData && dynamicData.total > 0 ? (
                    <>
                        {dynamicData.images > 0 && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                                <ImageIcon className="w-3 h-3" />
                                {dynamicData.images}
                            </span>
                        )}
                        {dynamicData.texts > 0 && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">
                                <Type className="w-3 h-3" />
                                {dynamicData.texts}
                            </span>
                        )}
                    </>
                ) : (
                    <span className="text-xs text-gray-400">No dynamic fields</span>
                )}
            </div>

            {/* Quick Actions */}
            <div className="hidden md:flex items-center gap-1 shrink-0">
                <Link
                    href={`/editor?template=${template.id}`}
                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Edit"
                >
                    <Edit className="w-4 h-4" />
                </Link>
                <button
                    onClick={() => onQuickEdit(template)}
                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Quick Edit"
                >
                    <Settings2 className="w-4 h-4" />
                </button>
                <button
                    onClick={() => onDuplicate(template.id)}
                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Duplicate"
                >
                    <Copy className="w-4 h-4" />
                </button>
                <button
                    onClick={() => onGenerate(template.id)}
                    className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    title="Generate"
                >
                    <Rocket className="w-4 h-4" />
                </button>
                <button
                    onClick={() => onDelete(template.id)}
                    className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>

            {/* Mobile Menu */}
            <div className="md:hidden relative">
                <button
                    onClick={() => setShowMenu(!showMenu)}
                    className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg"
                >
                    <MoreVertical className="w-4 h-4" />
                </button>
                {showMenu && (
                    <div className="absolute right-0 top-8 z-20 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[140px]">
                        <Link
                            href={`/editor?template=${template.id}`}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                            <Edit className="w-4 h-4" />
                            Edit
                        </Link>
                        <button
                            onClick={() => { setShowMenu(false); onQuickEdit(template); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                            <Settings2 className="w-4 h-4" />
                            Quick Edit
                        </button>
                        <button
                            onClick={() => { setShowMenu(false); onDuplicate(template.id); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                            <Copy className="w-4 h-4" />
                            Duplicate
                        </button>
                        <button
                            onClick={() => { setShowMenu(false); onGenerate(template.id); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                            <Rocket className="w-4 h-4" />
                            Generate
                        </button>
                        <div className="border-t border-gray-100 my-1" />
                        <button
                            onClick={() => { setShowMenu(false); onDelete(template.id); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                        >
                            <Trash2 className="w-4 h-4" />
                            Delete
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export function TemplateGrid({
    templates,
    dynamicDataMap,
    selectedIds,
    onSelect,
    onQuickEdit,
    onDuplicate,
    onDelete,
    onGenerate,
    viewMode,
    isLoading,
    hasFilters,
    onClearFilters,
}: TemplateGridProps) {
    // Loading state
    if (isLoading) {
        if (viewMode === 'list') {
            return (
                <div className="space-y-2">
                    {Array.from({ length: 10 }).map((_, i) => (
                        <SkeletonRow key={i} />
                    ))}
                </div>
            );
        }
        return (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                {Array.from({ length: 10 }).map((_, i) => (
                    <SkeletonCard key={i} />
                ))}
            </div>
        );
    }
    
    // Empty state
    if (templates.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                    <FileQuestion className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-1">
                    {hasFilters ? 'No templates match your filters' : 'No templates yet'}
                </h3>
                <p className="text-gray-500 mb-4 max-w-sm">
                    {hasFilters 
                        ? 'Try adjusting your filters or search query to find what you\'re looking for.'
                        : 'Create your first template to get started with pin generation.'
                    }
                </p>
                {hasFilters ? (
                    <button
                        onClick={onClearFilters}
                        className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                        Clear all filters
                    </button>
                ) : (
                    <Link
                        href="/editor"
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Create Template
                    </Link>
                )}
            </div>
        );
    }
    
    // List view
    if (viewMode === 'list') {
        return (
            <div className="space-y-2">
                {/* New Template Row */}
                <Link 
                    href="/editor" 
                    className="flex items-center gap-4 p-3 bg-white border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors group"
                >
                    <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 group-hover:bg-blue-200 transition-colors">
                        <Plus className="w-5 h-5 text-blue-600" />
                    </div>
                    <span className="text-sm font-medium text-gray-600 group-hover:text-blue-600">Create New Template</span>
                </Link>

                {/* Template Rows */}
                {templates.map(template => (
                    <TemplateRow
                        key={template.id}
                        template={template}
                        dynamicData={dynamicDataMap.get(template.id)}
                        isSelected={selectedIds.includes(template.id)}
                        onSelect={onSelect}
                        onQuickEdit={onQuickEdit}
                        onDuplicate={onDuplicate}
                        onDelete={onDelete}
                        onGenerate={onGenerate}
                    />
                ))}
            </div>
        );
    }

    // Grid view
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {/* Blank Canvas Card */}
            <Link href="/editor" className="group flex flex-col gap-3 cursor-pointer">
                <div className="aspect-[3/4] rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center bg-gray-50 group-hover:bg-blue-50 group-hover:border-blue-300 transition-colors">
                    <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                        <Plus className="w-6 h-6" />
                    </div>
                    <span className="text-sm font-medium text-gray-600 group-hover:text-blue-600">Blank Canvas</span>
                </div>
            </Link>
            
            {/* Template Cards */}
            {templates.map(template => (
                <TemplateCard
                    key={template.id}
                    template={template}
                    dynamicData={dynamicDataMap.get(template.id)}
                    isSelected={selectedIds.includes(template.id)}
                    onSelect={onSelect}
                    onQuickEdit={onQuickEdit}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                    onGenerate={onGenerate}
                />
            ))}
        </div>
    );
}
