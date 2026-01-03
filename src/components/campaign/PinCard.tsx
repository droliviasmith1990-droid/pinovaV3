'use client';

import React, { useState, memo } from 'react';
import { Download, Eye, Link2, Check, AlertCircle, Loader2, Trash2, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SelectionCheckbox } from '@/components/ui/BulkActions';

export interface PinCardData {
    id: string;
    rowIndex: number;
    imageUrl: string;
    status: 'completed' | 'failed' | 'pending' | 'generated';
    errorMessage?: string;
    csvData?: Record<string, string>;
}

interface PinCardProps {
    pin: PinCardData;
    isSelected?: boolean;
    onSelect?: (selected: boolean) => void;
    showSelection?: boolean;
    onPreview?: (pin: PinCardData) => void;
    onDelete?: (pin: PinCardData) => void;
    onRegenerate?: (pin: PinCardData) => void;
}

export const PinCard = memo(function PinCard({
    pin,
    isSelected = false,
    onSelect,
    showSelection = false,
    onPreview,
    onDelete,
    onRegenerate,
}: PinCardProps) {
    const [isCopied, setIsCopied] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);

    // Helper to check if pin is successfully generated
    const isSuccess = pin.status === 'completed' || pin.status === 'generated';

    const handleCopyUrl = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(pin.imageUrl);
            setIsCopied(true);
            toast.success('Image URL copied to clipboard!');
            setTimeout(() => setIsCopied(false), 2000);
        } catch {
            toast.error('Failed to copy URL');
        }
    };

    const handleDownload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsDownloading(true);
        try {
            const response = await fetch(pin.imageUrl);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `pin-${pin.rowIndex + 1}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            toast.success('Image downloaded!');
        } catch {
            toast.error('Failed to download image');
        } finally {
            setIsDownloading(false);
        }
    };

    const handlePreview = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onPreview) {
            onPreview(pin);
        } else {
            window.open(pin.imageUrl, '_blank');
        }
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onDelete) {
            onDelete(pin);
        }
    };

    const handleRegenerate = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onRegenerate) {
            setIsRegenerating(true);
            try {
                await onRegenerate(pin);
            } finally {
                setIsRegenerating(false);
            }
        }
    };

    return (
        <div
            className={cn(
                "group bg-white rounded-xl border overflow-hidden shadow-sm hover:shadow-md transition-all duration-200",
                isSelected ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-200"
            )}
        >
            {/* Top Actions - Download + Preview ABOVE image */}
            <div className="flex justify-center gap-2 p-2 bg-gray-50 border-b border-gray-100">
                {/* Download Button */}
                <button
                    onClick={handleDownload}
                    disabled={!isSuccess || isDownloading}
                    className={cn(
                        "w-10 h-10 flex items-center justify-center rounded-lg border transition-colors",
                        isSuccess
                            ? "border-gray-200 bg-white text-gray-700 hover:bg-gray-100 active:bg-gray-200"
                            : "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed"
                    )}
                    title="Download pin"
                    aria-label="Download pin"
                >
                    {isDownloading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <Download className="w-5 h-5" />
                    )}
                </button>

                {/* Preview Button */}
                <button
                    onClick={handlePreview}
                    disabled={!isSuccess}
                    className={cn(
                        "w-10 h-10 flex items-center justify-center rounded-lg transition-colors",
                        isSuccess
                            ? "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"
                            : "bg-gray-100 text-gray-300 cursor-not-allowed"
                    )}
                    title="Preview pin"
                    aria-label="Preview pin"
                >
                    <Eye className="w-5 h-5" />
                </button>
            </div>

            {/* Image Section */}
            <div className="relative aspect-[2/3] bg-gray-100">
                {isSuccess && pin.imageUrl ? (
                    <img
                        src={pin.imageUrl}
                        alt={`Pin ${pin.rowIndex + 1}`}
                        className="w-full h-full object-cover"
                        // Add onError handler
                        onError={(e) => {
                            // If image fails to load, we can optionally switch to error state 
                            // or just hide the image. For now, let's log it.
                            console.error(`Image failed to load: ${pin.imageUrl}`);
                            e.currentTarget.style.display = 'none';
                            // Note: We can't easily switch 'status' here without triggering a re-render/state update from child.
                            // But hiding the broken image is better than a broken icon.
                        }}
                        loading="lazy"
                    />
                ) : pin.status === 'failed' ? (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-red-50 p-4">
                        <AlertCircle className="w-10 h-10 text-red-400 mb-2" />
                        <p className="text-sm text-red-600 text-center font-medium">Generation Failed</p>
                        <p className="text-xs text-red-500 text-center mt-1 mb-3 max-w-[180px] break-words">{pin.errorMessage || 'Unknown error'}</p>
                        
                        {onRegenerate && (
                            <button
                                onClick={handleRegenerate}
                                disabled={isRegenerating}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 transition-colors shadow-sm"
                            >
                                {isRegenerating ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <RotateCw className="w-3.5 h-3.5" />
                                )}
                                {isRegenerating ? 'Retrying...' : 'Regenerate'}
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-100">
                        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
                    </div>
                )}

                {/* Pin Number Badge - Top Left */}
                <div className="absolute top-3 left-3 w-8 h-8 bg-black/70 text-white text-sm font-bold rounded-full flex items-center justify-center">
                    {pin.rowIndex + 1}
                </div>

                {/* Selection Checkbox - Top Right */}
                {onSelect && (
                    <div className="absolute top-3 right-3">
                        <SelectionCheckbox
                            isSelected={isSelected}
                            onChange={onSelect}
                            isVisible={showSelection || isSelected}
                        />
                    </div>
                )}
            </div>

            {/* URL Preview */}
            {isSuccess && pin.imageUrl && (
                <div className="px-3 py-2 border-t border-gray-100">
                    <p
                        className="text-xs text-gray-400 truncate text-center"
                        title={pin.imageUrl}
                    >
                        {pin.imageUrl.replace(/^https?:\/\//, '').substring(0, 30)}...
                    </p>
                </div>
            )}

            {/* Bottom Actions - Copy Link + Delete BELOW */}
            <div className="flex justify-center gap-2 p-2 bg-gray-50 border-t border-gray-100">
                {/* Copy URL Button */}
                <button
                    onClick={handleCopyUrl}
                    disabled={!isSuccess}
                    className={cn(
                        "w-10 h-10 flex items-center justify-center rounded-lg border transition-colors",
                        isSuccess
                            ? isCopied
                                ? "border-green-300 bg-green-50 text-green-600"
                                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-100 active:bg-gray-200"
                            : "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed"
                    )}
                    title={isCopied ? "Copied!" : "Copy URL"}
                    aria-label="Copy image URL"
                >
                    {isCopied ? (
                        <Check className="w-5 h-5" />
                    ) : (
                        <Link2 className="w-5 h-5" />
                    )}
                </button>

                {/* Delete Button */}
                {onDelete && (
                    <button
                        onClick={handleDelete}
                        disabled={pin.status === 'pending'}
                        className={cn(
                            "w-10 h-10 flex items-center justify-center rounded-lg border transition-colors",
                            pin.status !== 'pending'
                                ? "border-gray-200 bg-white text-red-500 hover:bg-red-50 hover:border-red-200 active:bg-red-100"
                                : "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed"
                        )}
                        title="Delete pin"
                        aria-label="Delete pin"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                )}
            </div>
        </div>
    );
});

// ============================================
// Pins Grid Component with Bulk Selection
// ============================================
interface PinsGridProps {
    pins: PinCardData[];
    selectedIds?: Set<string>;
    onSelectPin?: (pinId: string, selected: boolean) => void;
    showSelection?: boolean;
    onPreview?: (pin: PinCardData) => void;
    onDeletePin?: (pin: PinCardData) => void;
    onRegeneratePin?: (pin: PinCardData) => void;
}

export function PinsGrid({
    pins,
    selectedIds = new Set(),
    onSelectPin,
    showSelection = false,
    onPreview,
    onDeletePin,
    onRegeneratePin,
}: PinsGridProps) {
    if (pins.length === 0) {
        return (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">No pins generated yet</h3>
                <p className="text-gray-500 text-sm">Start the generation process to create your pins.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {pins.map((pin) => (
                <PinCard
                    key={pin.id}
                    pin={pin}
                    isSelected={selectedIds.has(pin.id)}
                    onSelect={onSelectPin ? (selected) => onSelectPin(pin.id, selected) : undefined}
                    showSelection={showSelection}
                    onPreview={onPreview}
                    onDelete={onDeletePin}
                    onRegenerate={onRegeneratePin}
                />
            ))}
        </div>
    );
}

// ============================================
// Pin Card Skeleton for Loading State
// ============================================
export function PinCardSkeleton() {
    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm animate-pulse">
            <div className="aspect-[2/3] bg-gray-200" />
            <div className="px-3 py-2.5 border-b border-gray-100">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
            </div>
            <div className="flex justify-center gap-2 p-2">
                <div className="w-10 h-10 bg-gray-200 rounded-lg" />
                <div className="w-10 h-10 bg-gray-200 rounded-lg" />
                <div className="w-10 h-10 bg-gray-200 rounded-lg" />
                <div className="w-10 h-10 bg-gray-200 rounded-lg" />
            </div>
        </div>
    );
}
