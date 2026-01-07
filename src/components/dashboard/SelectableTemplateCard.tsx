import React from 'react';
import Image from 'next/image';
import { Check, Star, Layout } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TemplateListItem } from '@/lib/db/templates';
import { getCacheBustedThumbnailUrl } from '@/lib/utils/thumbnailUrl';

interface SelectableTemplateCardProps {
    template: TemplateListItem;
    isSelected: boolean;
    onSelect: (template: TemplateListItem) => void;
}

export function SelectableTemplateCard({ template, isSelected, onSelect }: SelectableTemplateCardProps) {
    return (
        <button
            onClick={() => onSelect(template)}
            className={cn(
                "group relative w-full text-left transition-all duration-300 rounded-2xl overflow-hidden",
                "bg-surface-light dark:bg-surface-dark",
                "border-2",
                isSelected
                    ? "border-primary-creative scale-[1.02] shadow-creative-md shadow-purple-500/20"
                    : "border-transparent hover:border-accent-1/50 hover:shadow-creative-md hover:-translate-y-1"
            )}
        >
            {/* Thumbnail Container */}
            <div className="relative aspect-2/3 bg-gray-100 dark:bg-gray-800 overflow-hidden">
                {template.thumbnail_url ? (
                    <Image
                        src={getCacheBustedThumbnailUrl(template.thumbnail_url, template.updated_at) || template.thumbnail_url}
                        alt={template.name}
                        fill
                        className={cn(
                            "object-cover transition-transform duration-500",
                            isSelected ? "scale-105" : "group-hover:scale-110"
                        )}
                    />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/50">
                        <Layout className="w-12 h-12 mb-2 opacity-50" />
                        <span className="text-xs font-medium">No Preview</span>
                    </div>
                )}

                {/* Gradient Overlay (Hover) */}
                <div className={cn(
                    "absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300",
                    isSelected ? "opacity-30" : "group-hover:opacity-100"
                )} />

                {/* Selection Overlay */}
                {isSelected && (
                    <div className="absolute inset-0 bg-primary-creative/10 z-10 grid place-items-center backdrop-blur-[1px]">
                         <div className="w-12 h-12 bg-primary-creative text-white rounded-full flex items-center justify-center shadow-lg transform scale-100 animate-in zoom-in duration-200">
                            <Check className="w-7 h-7 stroke-3" />
                         </div>
                    </div>
                )}

                {/* Badges */}
                <div className="absolute top-3 left-3 right-3 flex justify-between items-start z-20">
                     {/* Featured Badge */}
                    {template.is_featured && (
                         <div className="px-2 py-1 bg-linear-to-r from-amber-400 to-orange-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-md shadow-sm flex items-center gap-1">
                            <Star className="w-3 h-3 fill-current" />
                            Featured
                        </div>
                    )}
                </div>

                {/* Hover UI */}
                {!isSelected && (
                    <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-full group-hover:translate-y-0 transition-transform duration-300 z-20">
                         <span className="block w-full py-2 bg-white/90 dark:bg-black/80 backdrop-blur text-center text-sm font-semibold text-gray-900 dark:text-white rounded-lg shadow-sm">
                            Select Template
                        </span>
                    </div>
                )}
            </div>

            {/* Content Section */}
            <div className="p-4 relative">
                <h3 className={cn(
                    "font-heading font-semibold text-lg mb-1 truncate transition-colors",
                    isSelected ? "text-primary-creative dark:text-accent-1" : "text-gray-900 dark:text-white"
                )}>
                    {template.name}
                </h3>
                
                <div className="flex items-center justify-between mt-2">
                     <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                        {template.category_data ? (
                             <span className="flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded-md">
                                {template.category_data.icon && <span>{template.category_data.icon}</span>}
                                {template.category_data.name}
                            </span>
                        ) : (
                            <span className="text-gray-400 italic">Uncategorized</span>
                        )}
                     </div>

                     {template.view_count !== undefined && (
                         <span className="text-[10px] text-gray-400 flex items-center gap-1">
                             <Layout className="w-3 h-3" />
                             {template.view_count} uses
                         </span>
                     )}
                </div>
            </div>
        </button>
    );
}
