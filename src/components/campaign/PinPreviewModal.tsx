'use client';

import React, { useEffect, useCallback } from 'react';
import Image from 'next/image';
import { X, ChevronLeft, ChevronRight, Download, Link2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PinCardData } from './PinCard';
import { toast } from 'sonner';

interface PinPreviewModalProps {
    pin: PinCardData | null;
    pins: PinCardData[];
    onClose: () => void;
    onNavigate: (pin: PinCardData) => void;
}

export function PinPreviewModal({ pin, pins, onClose, onNavigate }: PinPreviewModalProps) {
    const [isCopied, setIsCopied] = React.useState(false);

    // Get current index and navigation info
    const currentIndex = pin ? pins.findIndex(p => p.id === pin.id) : -1;
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < pins.length - 1;

    const navigatePrev = useCallback(() => {
        if (hasPrev && pins[currentIndex - 1]) {
            onNavigate(pins[currentIndex - 1]);
        }
    }, [hasPrev, pins, currentIndex, onNavigate]);

    const navigateNext = useCallback(() => {
        if (hasNext && pins[currentIndex + 1]) {
            onNavigate(pins[currentIndex + 1]);
        }
    }, [hasNext, pins, currentIndex, onNavigate]);

    // Keyboard navigation
    useEffect(() => {
        if (!pin) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'Escape':
                    onClose();
                    break;
                case 'ArrowLeft':
                    navigatePrev();
                    break;
                case 'ArrowRight':
                    navigateNext();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [pin, onClose, navigatePrev, navigateNext]);

    // Handle copy URL
    const handleCopyUrl = async () => {
        if (!pin?.imageUrl) return;
        try {
            await navigator.clipboard.writeText(pin.imageUrl);
            setIsCopied(true);
            toast.success('URL copied!');
            setTimeout(() => setIsCopied(false), 2000);
        } catch {
            toast.error('Failed to copy');
        }
    };

    // Handle download
    const handleDownload = async () => {
        if (!pin?.imageUrl) return;
        try {
            const response = await fetch(pin.imageUrl);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `pin-${pin.rowIndex + 1}.png`;
            link.click();
            URL.revokeObjectURL(url);
            toast.success('Download started');
        } catch {
            toast.error('Download failed');
        }
    };

    if (!pin) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
            onClick={onClose}
        >
            {/* Close Button */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 text-white/80 hover:text-white bg-black/50 hover:bg-black/70 rounded-full transition-all z-10"
                aria-label="Close preview"
            >
                <X className="w-6 h-6" />
            </button>

            {/* Navigation Arrows */}
            {hasPrev && (
                <button
                    onClick={(e) => { e.stopPropagation(); navigatePrev(); }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/80 hover:text-white bg-black/50 hover:bg-black/70 rounded-full transition-all z-10"
                    aria-label="Previous pin"
                >
                    <ChevronLeft className="w-8 h-8" />
                </button>
            )}

            {hasNext && (
                <button
                    onClick={(e) => { e.stopPropagation(); navigateNext(); }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/80 hover:text-white bg-black/50 hover:bg-black/70 rounded-full transition-all z-10"
                    aria-label="Next pin"
                >
                    <ChevronRight className="w-8 h-8" />
                </button>
            )}

            {/* Image Container */}
            <div
                className="relative max-w-[90vw] max-h-[85vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <Image
                    src={pin.imageUrl}
                    alt={`Pin ${pin.rowIndex + 1}`}
                    width={1000}
                    height={1500}
                    className="max-w-full max-h-[85vh] w-auto h-auto rounded-lg shadow-2xl"
                    unoptimized
                    priority
                />

                {/* Bottom Info Bar */}
                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent rounded-b-lg">
                    <div className="flex items-center justify-between">
                        <div className="text-white">
                            <span className="text-lg font-semibold">Pin #{pin.rowIndex + 1}</span>
                            <span className="text-white/60 ml-3">
                                {currentIndex + 1} of {pins.length}
                            </span>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleCopyUrl}
                                className={cn(
                                    "p-2 rounded-lg transition-all",
                                    isCopied 
                                        ? "bg-green-500 text-white" 
                                        : "bg-white/20 text-white hover:bg-white/30"
                                )}
                                aria-label="Copy URL"
                            >
                                {isCopied ? <Check className="w-5 h-5" /> : <Link2 className="w-5 h-5" />}
                            </button>
                            <button
                                onClick={handleDownload}
                                className="p-2 bg-white/20 text-white hover:bg-white/30 rounded-lg transition-all"
                                aria-label="Download"
                            >
                                <Download className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Keyboard Hint */}
                    <div className="mt-2 text-white/50 text-xs">
                        Use ← → to navigate • ESC to close
                    </div>
                </div>
            </div>
        </div>
    );
}
