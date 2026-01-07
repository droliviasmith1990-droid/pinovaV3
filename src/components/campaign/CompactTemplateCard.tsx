'use client';

import React, { memo } from 'react';
import Image from 'next/image';
import { Check, Star, ImageIcon, Type, Layout, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TemplateListItem } from '@/lib/db/templates';
import { DynamicDataSummary } from '@/lib/utils/extractDynamicData';
import { getCacheBustedThumbnailUrl } from '@/lib/utils/thumbnailUrl';

interface CompactTemplateCardProps {
    template: TemplateListItem;
    dynamicData?: DynamicDataSummary;
    isSelected: boolean;
    onSelect: (template: TemplateListItem) => void;
}

// Memoized component to prevent unnecessary re-renders
export const CompactTemplateCard = memo(function CompactTemplateCard({ 
    template, 
    dynamicData,
    isSelected, 
    onSelect 
}: CompactTemplateCardProps) {
    return (
        <button
            type="button"
            onClick={() => onSelect(template)}
            className={cn(
                "group relative w-full text-left transition-all duration-200 rounded-xl overflow-hidden",
                "bg-white border-2",
                "focus:outline-none focus:ring-2 focus:ring-blue-500/30",
                isSelected
                    ? "border-blue-500 shadow-md shadow-blue-500/20 scale-[1.02]"
                    : "border-gray-200 hover:border-gray-300 hover:shadow-md hover:-translate-y-0.5"
            )}
        >
            {/* Thumbnail Container - 2:3 aspect ratio */}
            <div className="relative aspect-2/3 bg-gray-100 overflow-hidden">
                {template.thumbnail_url ? (
                    <Image
                        src={getCacheBustedThumbnailUrl(template.thumbnail_url, template.updated_at) || template.thumbnail_url}
                        alt={template.name}
                        fill
                        loading="lazy"
                        placeholder="empty"
                        className={cn(
                            "object-cover transition-transform duration-300",
                            isSelected ? "scale-105" : "group-hover:scale-105"
                        )}
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                    />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-linear-to-br from-gray-50 to-gray-200">
                        <Layout className="w-8 h-8 mb-1 opacity-50" />
                        <span className="text-xs">No Preview</span>
                    </div>
                )}

                {/* Selection Overlay */}
                {isSelected && (
                    <div className="absolute inset-0 bg-blue-500/20 backdrop-blur-[1px] flex items-center justify-center z-10">
                        <div className="w-10 h-10 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-lg animate-in zoom-in duration-150">
                            <Check className="w-5 h-5 stroke-3" />
                        </div>
                    </div>
                )}

                {/* Featured Badge - Top Right */}
                {template.is_featured && (
                    <div className="absolute top-2 right-2 z-20">
                        <div className="px-1.5 py-0.5 bg-amber-500 text-white rounded-md shadow-sm flex items-center gap-0.5">
                            <Star className="w-3 h-3 fill-current" />
                            <span className="text-[10px] font-semibold">Featured</span>
                        </div>
                    </div>
                )}

                {/* Hover Overlay (when not selected) */}
                {!isSelected && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <span className="px-3 py-1.5 bg-white/95 text-gray-800 text-xs font-medium rounded-lg shadow-sm">
                            Click to select
                        </span>
                    </div>
                )}
            </div>

            {/* Content Section */}
            <div className="p-2.5 space-y-1.5">
                {/* Name */}
                <h3 className={cn(
                    "text-sm font-medium truncate transition-colors",
                    isSelected ? "text-blue-700" : "text-gray-900"
                )}>
                    {template.name}
                </h3>

                {/* Dynamic Data Badges */}
                {dynamicData && dynamicData.total > 0 && (
                    <div className="flex items-center gap-1.5">
                        {dynamicData.images > 0 && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-medium rounded">
                                <ImageIcon className="w-3 h-3" />
                                {dynamicData.images}
                            </span>
                        )}
                        {dynamicData.texts > 0 && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] font-medium rounded">
                                <Type className="w-3 h-3" />
                                {dynamicData.texts}
                            </span>
                        )}
                    </div>
                )}

                {/* Category */}
                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                    {template.category_data ? (
                        <>
                            {template.category_data.icon ? (
                                <span>{template.category_data.icon}</span>
                            ) : (
                                <Folder className="w-3 h-3" />
                            )}
                            <span className="truncate">{template.category_data.name}</span>
                        </>
                    ) : (
                        <>
                            <Folder className="w-3 h-3 text-gray-400" />
                            <span className="italic text-gray-400">Uncategorized</span>
                        </>
                    )}
                </div>
            </div>
        </button>
    );
}, (prevProps, nextProps) => {
    // Custom comparison for memo - only re-render when these change
    // IMPORTANT: Include onSelect to ensure callback changes trigger re-render
    return (
        prevProps.template.id === nextProps.template.id &&
        prevProps.template.name === nextProps.template.name &&
        prevProps.template.thumbnail_url === nextProps.template.thumbnail_url &&
        prevProps.template.is_featured === nextProps.template.is_featured &&
        prevProps.isSelected === nextProps.isSelected &&
        prevProps.onSelect === nextProps.onSelect && // Fix: include callback comparison
        prevProps.dynamicData?.images === nextProps.dynamicData?.images &&
        prevProps.dynamicData?.texts === nextProps.dynamicData?.texts &&
        prevProps.template.category_data?.id === nextProps.template.category_data?.id
    );
});
