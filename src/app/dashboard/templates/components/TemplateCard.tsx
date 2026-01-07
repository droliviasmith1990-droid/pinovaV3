'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { 
    MoreVertical, 
    Edit, 
    Copy, 
    Check,
    Trash2, 
    Rocket, 
    Star,
    ImageIcon,
    Type,
    Settings2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TemplateListItem } from '@/lib/db/templates';
import { DynamicDataSummary } from '@/lib/utils/extractDynamicData';
import { getCacheBustedThumbnailUrl } from '@/lib/utils/thumbnailUrl';

interface TemplateCardProps {
    template: TemplateListItem;
    dynamicData?: DynamicDataSummary;
    isSelected: boolean;
    onSelect: (id: string, selected: boolean) => void;
    onQuickEdit: (template: TemplateListItem) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    onGenerate: (id: string) => void;
}

export function TemplateCard({
    template,
    dynamicData,
    isSelected,
    onSelect,
    onQuickEdit,
    onDuplicate,
    onDelete,
    onGenerate,
}: TemplateCardProps) {
    const [showMenu, setShowMenu] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleCopyShortId = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!template.short_id) return;
        
        try {
            await navigator.clipboard.writeText(template.short_id);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error('Failed to copy:', error);
        }
    };

    const handleCheckboxClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onSelect(template.id, !isSelected);
    };

    const handleAction = (e: React.MouseEvent, action: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        setShowMenu(false);
        action();
    };

    return (
        <div 
            className={cn(
                "group relative flex flex-col gap-3 cursor-pointer",
                isSelected && "ring-2 ring-blue-500 rounded-xl"
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => {
                setIsHovered(false);
                setShowMenu(false);
            }}
        >
            {/* Thumbnail Container */}
            <div className={cn(
                "aspect-[3/4] rounded-xl relative overflow-hidden transition-all duration-300",
                "bg-gray-200",
                isHovered && "shadow-lg",
                isSelected && "bg-blue-50"
            )}>
                {/* Thumbnail Image */}
                {template.thumbnail_url ? (
                    <Image
                        src={getCacheBustedThumbnailUrl(template.thumbnail_url, template.updated_at) || template.thumbnail_url}
                        alt={template.name}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 50vw, (max-width: 1024px) 25vw, 20vw"
                    />
                ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-300 flex items-center justify-center">
                        <span className="text-gray-400 text-sm">No preview</span>
                    </div>
                )}

                {/* Selection Checkbox - Top Left */}
                <div 
                    className={cn(
                        "absolute top-2 left-2 z-10 transition-opacity",
                        isHovered || isSelected ? "opacity-100" : "opacity-0"
                    )}
                    onClick={handleCheckboxClick}
                >
                    <div className={cn(
                        "w-6 h-6 rounded border-2 flex items-center justify-center cursor-pointer transition-colors",
                        isSelected 
                            ? "bg-blue-500 border-blue-500 text-white" 
                            : "bg-white/90 border-gray-300 hover:border-blue-400"
                    )}>
                        {isSelected && (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                        )}
                    </div>
                </div>

                {/* Featured Badge - Top Right */}
                {template.is_featured && (
                    <div className="absolute top-2 right-2 z-10">
                        <div className="bg-amber-500 text-white p-1.5 rounded-lg shadow">
                            <Star className="w-3.5 h-3.5 fill-current" />
                        </div>
                    </div>
                )}

                {/* Three-Dot Menu Button - Mobile/Always Visible */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(!showMenu);
                    }}
                    className={cn(
                        "absolute top-2 right-2 z-20 p-1.5 bg-white/90 rounded-lg shadow-sm transition-opacity",
                        "hover:bg-white",
                        template.is_featured ? "right-10" : "right-2",
                        isHovered ? "opacity-100" : "opacity-0 md:opacity-0"
                    )}
                >
                    <MoreVertical className="w-4 h-4 text-gray-600" />
                </button>

                {/* Dropdown Menu */}
                {showMenu && (
                    <div 
                        className="absolute top-10 right-2 z-30 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[160px]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Link
                            href={`/editor?template=${template.id}`}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                            <Edit className="w-4 h-4" />
                            Edit
                        </Link>
                        <button
                            onClick={(e) => handleAction(e, () => onQuickEdit(template))}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                            <Settings2 className="w-4 h-4" />
                            Quick Edit
                        </button>
                        <button
                            onClick={(e) => handleAction(e, () => onDuplicate(template.id))}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                            <Copy className="w-4 h-4" />
                            Duplicate
                        </button>
                        <button
                            onClick={(e) => handleAction(e, () => onGenerate(template.id))}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                            <Rocket className="w-4 h-4" />
                            Generate
                        </button>
                        <div className="border-t border-gray-100 my-1" />
                        <button
                            onClick={(e) => handleAction(e, () => onDelete(template.id))}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                        >
                            <Trash2 className="w-4 h-4" />
                            Delete
                        </button>
                    </div>
                )}

                {/* Hover Action Bar - Desktop WordPress Style */}
                <div className={cn(
                    "absolute bottom-0 left-0 right-0 bg-black/70 px-3 py-2 transition-opacity duration-200",
                    "hidden md:block",
                    isHovered ? "opacity-100" : "opacity-0"
                )}>
                    <div className="flex items-center justify-center gap-1 text-xs">
                        <Link
                            href={`/editor?template=${template.id}`}
                            className="text-white font-medium hover:text-blue-300"
                        >
                            Edit
                        </Link>
                        <span className="text-gray-400">|</span>
                        <button
                            onClick={(e) => handleAction(e, () => onQuickEdit(template))}
                            className="text-white hover:text-blue-300"
                        >
                            Quick Edit
                        </button>
                        <span className="text-gray-400">|</span>
                        <button
                            onClick={(e) => handleAction(e, () => onDuplicate(template.id))}
                            className="text-white hover:text-blue-300"
                        >
                            Duplicate
                        </button>
                        <span className="text-gray-400">|</span>
                        <button
                            onClick={(e) => handleAction(e, () => onDelete(template.id))}
                            className="text-red-400 hover:text-red-300"
                        >
                            Delete
                        </button>
                        <span className="text-gray-400">|</span>
                        <button
                            onClick={(e) => handleAction(e, () => onGenerate(template.id))}
                            className="text-green-400 hover:text-green-300"
                        >
                            Generate
                        </button>
                    </div>
                </div>
            </div>

            {/* Template Info */}
            <div className="space-y-1">
                <h3 className="text-sm font-medium text-gray-900 truncate">
                    {template.name}
                </h3>
                
                {/* Template ID with Copy Button */}
                {template.short_id && (
                    <div className="flex items-center gap-1.5">
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono text-gray-600 truncate max-w-[140px]">
                            {template.short_id}
                        </code>
                        <button
                            onClick={handleCopyShortId}
                            className="p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                            title="Copy Template ID"
                        >
                            {copied ? (
                                <Check className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                                <Copy className="w-3.5 h-3.5" />
                            )}
                        </button>
                    </div>
                )}
                
                {/* Category */}
                {template.category_data && (
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                        {template.category_data.icon && <span>{template.category_data.icon}</span>}
                        {template.category_data.name}
                    </p>
                )}

                {/* Dynamic Data Badges */}
                {dynamicData && dynamicData.total > 0 && (
                    <div className="flex items-center gap-2 mt-1">
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
                    </div>
                )}
            </div>
        </div>
    );
}
