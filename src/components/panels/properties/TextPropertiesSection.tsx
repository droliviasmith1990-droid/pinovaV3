'use client';

import React, { memo, useCallback, useState, useEffect, useMemo } from 'react';
import { AlignLeft, AlignCenter, AlignRight, Zap, Eye, EyeOff } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { TextElement } from '@/types/editor';
import { cn } from '@/lib/utils';
import { SectionHeader } from './shared';
import { applyAutoFitDirect, getGlobalCanvasManager } from '@/lib/canvas/CanvasManager';
import { calculateBestFitFontSize } from '@/lib/canvas/AutoFitText';

interface TextPropertiesSectionProps {
    element: TextElement;
}

export const TextPropertiesSection = memo(function TextPropertiesSection({ element }: TextPropertiesSectionProps) {
    const updateElement = useEditorStore((s) => s.updateElement);
    
    // Get live element from store for reactive updates
    const liveElement = useEditorStore((state) => 
        state.elements.find(el => el.id === element.id) as TextElement | undefined
    ) || element;

    // Local state for preview mode toggle
    const [showPreview, setShowPreview] = useState(!!liveElement.previewText);
    
    // Track calculated font size from Fabric object (for badge display)
    const [calculatedFontSize, setCalculatedFontSize] = useState<number | null>(null);
    
    // Fetch calculated font from Fabric object when autoFit is enabled
    useEffect(() => {
        if (!liveElement.autoFit) {
            setCalculatedFontSize(null);
            return;
        }
        
        const updateCalculatedFont = () => {
            const manager = getGlobalCanvasManager();
            if (!manager) return;
            
            // Access elementMap to get actual fabric font size
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fabricObj = (manager as any).elementMap?.get(element.id);
            if (fabricObj && fabricObj.type === 'textbox') {
                const fontSize = Math.round(fabricObj.fontSize || 0);
                if (fontSize && fontSize !== liveElement.fontSize) {
                    setCalculatedFontSize(fontSize);
                } else {
                    setCalculatedFontSize(null);
                }
            }
        };
        
        // Initial fetch
        updateCalculatedFont();
        
        // Poll for updates (font changes during resize)
        const interval = setInterval(updateCalculatedFont, 200);
        return () => clearInterval(interval);
    }, [element.id, liveElement.autoFit, liveElement.fontSize]);
    
    // Calculate estimated font sizes for different text lengths (for dynamic fields)
    const lengthPreviews = useMemo(() => {
        if (!liveElement.autoFit || !liveElement.isDynamic) return null;
        
        const samples = {
            short: 'Short',        // ~5 chars
            medium: 'Medium length text', // ~18 chars
            long: 'This is a much longer text that might need smaller font', // ~55 chars
        };
        
        const config = {
            fontFamily: liveElement.fontFamily || 'Arial',
            fontWeight: liveElement.fontWeight || 'normal',
            fontStyle: liveElement.fontStyle || 'normal',
            lineHeight: liveElement.lineHeight || 1.2,
            textAlign: liveElement.align || 'left',
            minFontSize: liveElement.minFontSize || 10,
            maxFontSize: liveElement.maxFontSize || 500,
            maxLines: liveElement.maxLines,
        };
        
        try {
            return {
                short: calculateBestFitFontSize(samples.short, liveElement.width, liveElement.height, config).fontSize,
                medium: calculateBestFitFontSize(samples.medium, liveElement.width, liveElement.height, config).fontSize,
                long: calculateBestFitFontSize(samples.long, liveElement.width, liveElement.height, config).fontSize,
            };
        } catch {
            return null;
        }
    }, [liveElement.autoFit, liveElement.isDynamic, liveElement.width, liveElement.height, 
        liveElement.fontFamily, liveElement.fontWeight, liveElement.fontStyle, liveElement.lineHeight,
        liveElement.align, liveElement.minFontSize, liveElement.maxFontSize, liveElement.maxLines]);
    
    
    const handleChange = useCallback((updates: Partial<TextElement>) => {
        updateElement(element.id, updates);
    }, [element.id, updateElement]);

    const handleDynamicToggle = useCallback((isDynamic: boolean) => {
        if (isDynamic) {
            // When enabling dynamic, ensure we have a placeholder
            const fieldName = liveElement.dynamicField || liveElement.name || 'text1';
            handleChange({ 
                isDynamic: true, 
                dynamicField: fieldName,
                text: `{{${fieldName}}}`
            });
        } else {
            // When disabling dynamic, use preview text or placeholder
            handleChange({ 
                isDynamic: false,
                text: liveElement.previewText || liveElement.text.replace(/\{\{.*?\}\}/g, 'Sample Text')
            });
        }
    }, [handleChange, liveElement]);

    const handlePreviewTextChange = useCallback((previewText: string) => {
        handleChange({ previewText });
    }, [handleChange]);

    const hasPlaceholder = liveElement.text.includes('{{');
    
    return (
        <div>
            <SectionHeader title="TEXT" />

            <div className="space-y-3">
                {/* Dynamic Field Toggle */}
                <div className="flex items-center justify-between p-2 bg-linear-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                    <div className="flex items-center gap-2">
                        <Zap className={cn("w-4 h-4", liveElement.isDynamic ? "text-purple-600" : "text-gray-400")} />
                        <span className="text-sm font-medium text-gray-700">Dynamic Field</span>
                    </div>
                    <button
                        onClick={() => handleDynamicToggle(!liveElement.isDynamic)}
                        className={cn(
                            "relative w-10 h-5 rounded-full transition-colors",
                            liveElement.isDynamic ? "bg-purple-500" : "bg-gray-300"
                        )}
                    >
                        <div className={cn(
                            "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
                            liveElement.isDynamic ? "translate-x-5" : "translate-x-0.5"
                        )} />
                    </button>
                </div>

                {/* Dynamic Field Name (when dynamic is ON) */}
                {liveElement.isDynamic && (
                    <div className="space-y-2">
                        <label className="text-xs text-gray-500">Field Name</label>
                        <input
                            type="text"
                            value={liveElement.dynamicField || ''}
                            onChange={(e) => {
                                const fieldName = e.target.value;
                                handleChange({ 
                                    dynamicField: fieldName,
                                    text: `{{${fieldName}}}`
                                });
                            }}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none"
                            placeholder="text1"
                        />
                    </div>
                )}

                {/* Preview Text (for dynamic fields) */}
                {liveElement.isDynamic && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-xs text-gray-500">Preview Text</label>
                            <button
                                onClick={() => setShowPreview(!showPreview)}
                                className="text-xs text-purple-600 hover:text-purple-700 flex items-center gap-1"
                            >
                                {showPreview ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                {showPreview ? 'Showing' : 'Show preview'}
                            </button>
                        </div>
                        <input
                            type="text"
                            value={liveElement.previewText || ''}
                            onChange={(e) => handlePreviewTextChange(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none"
                            placeholder="Enter preview content..."
                        />
                        <p className="text-[10px] text-gray-400">
                            Type sample text to see how it looks. Placeholder &quot;{`{{${liveElement.dynamicField || 'field'}}}`}&quot; is preserved.
                        </p>
                    </div>
                )}

                {/* Regular Text Input (when not dynamic OR viewing placeholder) */}
                {!liveElement.isDynamic && (
                    <textarea
                        value={liveElement.text}
                        onChange={(e) => handleChange({ text: e.target.value })}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all duration-150"
                        placeholder="Enter text..."
                    />
                )}

                {/* Show placeholder indicator when dynamic */}
                {liveElement.isDynamic && hasPlaceholder && (
                    <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-md border border-gray-200">
                        <span className="text-xs text-gray-500">Stored:</span>
                        <code className="text-xs font-mono text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                            {liveElement.text}
                        </code>
                    </div>
                )}

                {/* Text Alignment */}
                <div className="grid grid-cols-3 gap-2">
                    <button
                        onClick={() => handleChange({ align: 'left' })}
                        aria-label="Align text left"
                        className={cn(
                            "p-2 rounded border transition-colors",
                            liveElement.align === 'left' ? "bg-blue-50 border-blue-500" : "border-gray-300 hover:bg-gray-50"
                        )}
                    >
                        <AlignLeft className="w-4 h-4 mx-auto" />
                    </button>
                    <button
                        onClick={() => handleChange({ align: 'center' })}
                        aria-label="Align text center"
                        className={cn(
                            "p-2 rounded border transition-colors",
                            liveElement.align === 'center' ? "bg-blue-50 border-blue-500" : "border-gray-300 hover:bg-gray-50"
                        )}
                    >
                        <AlignCenter className="w-4 h-4 mx-auto" />
                    </button>
                    <button
                        onClick={() => handleChange({ align: 'right' })}
                        aria-label="Align text right"
                        className={cn(
                            "p-2 rounded border transition-colors",
                            liveElement.align === 'right' ? "bg-blue-50 border-blue-500" : "border-gray-300 hover:bg-gray-50"
                        )}
                    >
                        <AlignRight className="w-4 h-4 mx-auto" />
                    </button>
                </div>

                {/* Line Height */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-sm text-gray-600">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="21" y1="6" x2="3" y2="6" />
                                <line x1="21" y1="12" x2="3" y2="12" />
                                <line x1="21" y1="18" x2="3" y2="18" />
                                <path d="M9 3v18M15 3v18" strokeDasharray="2 2" opacity="0.4" />
                            </svg>
                            Line Height
                        </label>
                        <input
                            type="number"
                            min="0.5"
                            max="4"
                            step="0.1"
                            value={liveElement.lineHeight}
                            onChange={(e) => handleChange({ lineHeight: parseFloat(e.target.value) || 1 })}
                            className="w-16 px-2 py-1 text-sm border border-gray-200 rounded text-center focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
                        />
                    </div>
                    <input
                        type="range"
                        min="0.5"
                        max="4"
                        step="0.1"
                        value={liveElement.lineHeight}
                        onChange={(e) => handleChange({ lineHeight: parseFloat(e.target.value) })}
                        className="w-full accent-blue-600 h-2"
                    />
                </div>

                {/* Letter Spacing */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-sm text-gray-600">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <text x="2" y="16" fontSize="12" fill="currentColor" stroke="none">A</text>
                                <path d="M10 12h4" />
                                <path d="M10 10l-2 2 2 2" />
                                <path d="M14 10l2 2-2 2" />
                                <text x="16" y="16" fontSize="12" fill="currentColor" stroke="none">B</text>
                            </svg>
                            Letter Spacing
                        </label>
                        <input
                            type="number"
                            min="-10"
                            max="50"
                            step="0.5"
                            value={liveElement.letterSpacing}
                            onChange={(e) => handleChange({ letterSpacing: parseFloat(e.target.value) || 0 })}
                            className="w-16 px-2 py-1 text-sm border border-gray-200 rounded text-center focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none"
                        />
                    </div>
                    <input
                        type="range"
                        min="-10"
                        max="50"
                        step="0.5"
                        value={liveElement.letterSpacing}
                        onChange={(e) => handleChange({ letterSpacing: parseFloat(e.target.value) })}
                        className="w-full accent-blue-600 h-2"
                    />
                </div>

                {/* Auto Fit Text */}
                <div className="space-y-2 pt-2 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                            <Zap className={cn("w-3.5 h-3.5", liveElement.autoFit ? "text-amber-500 fill-amber-500" : "text-gray-400")} />
                            Auto Fit Text
                        </label>
                        <button
                            onClick={() => handleChange({ 
                                autoFit: !liveElement.autoFit,
                                // Set defaults if enabling
                                minFontSize: liveElement.minFontSize || 10,
                                maxFontSize: liveElement.maxFontSize || 100
                            })}
                            className={cn(
                                "relative w-9 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-200",
                                liveElement.autoFit ? "bg-amber-500" : "bg-gray-300"
                            )}
                        >
                            <span className={cn(
                                "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform",
                                liveElement.autoFit ? "translate-x-4" : "translate-x-0"
                            )} />
                        </button>
                    </div>

                    {/* Calculated Font Badge - shows when autoFit is active and font differs */}
                    {liveElement.autoFit && calculatedFontSize && (
                        <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg border border-green-200">
                            <span className="text-xs text-gray-600">Rendered at:</span>
                            <span className="text-sm font-semibold text-green-700">{calculatedFontSize}px</span>
                            <span className="text-xs text-gray-400">(base: {liveElement.fontSize}px)</span>
                        </div>
                    )}

                    {liveElement.autoFit && (
                        <div className="grid grid-cols-2 gap-3 p-2 bg-amber-50/50 rounded-lg border border-amber-100 animate-in fade-in slide-in-from-top-1">
                            <div className="space-y-1">
                                <label className="text-[10px] text-gray-500 uppercase font-semibold">Min Size</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        min={1}
                                        max={liveElement.maxFontSize || 500}
                                        value={liveElement.minFontSize || 10}
                                        onChange={(e) => handleChange({ minFontSize: parseInt(e.target.value) || 10 })}
                                        className="w-full px-2 py-1.5 text-sm border border-amber-200 rounded bg-white focus:border-amber-400 focus:ring-2 focus:ring-amber-200 outline-none"
                                    />
                                    <span className="absolute right-2 top-1.5 text-xs text-gray-400">px</span>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] text-gray-500 uppercase font-semibold">Max Size</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        min={liveElement.minFontSize || 1}
                                        max={500}
                                        value={liveElement.maxFontSize || 100}
                                        onChange={(e) => handleChange({ maxFontSize: parseInt(e.target.value) || 100 })}
                                        className="w-full px-2 py-1.5 text-sm border border-amber-200 rounded bg-white focus:border-amber-400 focus:ring-2 focus:ring-amber-200 outline-none"
                                    />
                                    <span className="absolute right-2 top-1.5 text-xs text-gray-400">px</span>
                                </div>
                            </div>
                            
                            {/* Max Lines Input */}
                            <div className="col-span-2 space-y-1">
                                <label className="text-[10px] text-gray-500 uppercase font-semibold">Max Lines (Optional)</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        min={1}
                                        value={liveElement.maxLines || ''}
                                        placeholder="Any"
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            handleChange({ maxLines: isNaN(val) ? undefined : val });
                                        }}
                                        className="w-full px-2 py-1.5 text-sm border border-amber-200 rounded bg-white focus:border-amber-400 focus:ring-2 focus:ring-amber-200 outline-none"
                                    />
                                </div>
                            </div>

                            {/* Apply Button */}
                             <div className="col-span-2 pt-1">
                                <button
                                    onClick={() => {
                                        // DIRECT approach: call canvas manager directly
                                        console.log('[Apply Auto Fit] Clicked, calling applyAutoFitDirect for:', element.id);
                                        const newFontSize = applyAutoFitDirect(element.id);
                                        console.log('[Apply Auto Fit] Result:', newFontSize);
                                    }}
                                    className="w-full py-1.5 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded transition-colors flex items-center justify-center gap-1"
                                >
                                    <Zap className="w-3 h-3" />
                                    Apply Auto Fit
                                </button>
                            </div>

                            {/* Dynamic Length Indicator - shows font range for different text lengths */}
                            {lengthPreviews && (
                                <div className="col-span-2 p-2 bg-purple-50 rounded-lg border border-purple-200 space-y-1.5">
                                    <span className="text-[10px] text-purple-600 uppercase font-semibold">Text Length Preview</span>
                                    <div className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-1">
                                            <span className="w-2 h-2 rounded-full bg-green-400"></span>
                                            <span className="text-gray-600">Short:</span>
                                        </div>
                                        <span className="font-medium text-green-700">{lengthPreviews.short}px</span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-1">
                                            <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
                                            <span className="text-gray-600">Medium:</span>
                                        </div>
                                        <span className="font-medium text-yellow-700">{lengthPreviews.medium}px</span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-1">
                                            <span className="w-2 h-2 rounded-full bg-red-400"></span>
                                            <span className="text-gray-600">Long:</span>
                                        </div>
                                        <span className="font-medium text-red-700">{lengthPreviews.long}px</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Font Size - ALWAYS editable (sets base/minimum for auto-fit) */}
                <div className="flex items-center justify-between">
                    <label className="text-sm text-gray-600">
                        {liveElement.autoFit ? 'Min Font Size' : 'Font Size'}
                    </label>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min={8}
                            max={500}
                            value={liveElement.fontSize || 16}
                            onChange={(e) => handleChange({ fontSize: parseInt(e.target.value) || 16 })}
                            className="w-20 px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none text-center bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                        />
                        <span className="text-xs text-gray-400">px</span>
                    </div>
                </div>
            </div>
        </div>
    );
});

