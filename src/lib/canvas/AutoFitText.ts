import * as fabric from 'fabric';

/**
 * Configuration for Auto-Fit calculation
 */
interface AutoFitConfig {
    fontFamily: string;
    fontWeight: string | number;
    fontStyle: string;
    lineHeight: number;
    textAlign: string;
    charSpacing?: number;
    // Size constraints
    minFontSize: number;
    maxFontSize: number;
    // Soft preference (ignored if can't fit)
    maxLines?: number;
    
    // Style properties for accurate measurement
    paintFirst?: string;
    underline?: boolean;
    linethrough?: boolean;
    overline?: boolean;
    objectCaching?: boolean;
    
    // Context for server-side rendering (avoids DOM dependency)
    fabricContext?: any; 
}

/**
 * Guard flag to prevent re-entry during auto-fit calculation
 */
let _isAutoFitRunning = false;

/**
 * Calculates the optimal font size to fit text within a fixed bounding box.
 * Uses binary search to find the largest size that fits.
 * 
 * Algorithm:
 * - Pass 1: Find largest font where height fits AND lineCount <= maxLines
 * - Pass 2: If Pass 1 fails, find largest font where just height fits (ignore maxLines)
 * - Fallback: Use minFontSize (allow overflow for edge cases)
 * 
 * @param text The text to fit
 * @param targetWidth Fixed width of the bounding box
 * @param targetHeight Fixed height of the bounding box (HARD constraint)
 * @param config Text properties and constraints
 * @returns Optimal font size
 */
/**
 * Result of auto-fit calculation including spacing adjustments
 */
export interface AutoFitResult {
    fontSize: number;
    charSpacing: number;
}

/**
 * Calculates the optimal font size to fit text within a fixed bounding box.
 * 
 * Strategy:
 * 1. Standard Fit: Binary search between minFontSize and maxFontSize.
 * 2. Tracking Compression: If minFontSize overflows, try reducing charSpacing.
 * 3. Emergency Shrink: If even compression fails, shrink font size below minFontSize (down to 6px).
 * 
 * @param text The text to fit
 * @param targetWidth Fixed width of the bounding box
 * @param targetHeight Fixed height of the bounding box (HARD constraint)
 * @param config Text properties and constraints
 * @returns Object containing optimal fontSize and charSpacing
 */
export function calculateBestFitFontSize(
    text: string,
    targetWidth: number,
    targetHeight: number,
    config: AutoFitConfig
): AutoFitResult {
    // 1. Sanity checks
    if (!text || targetWidth <= 0 || targetHeight <= 0) {
        return { fontSize: config.minFontSize, charSpacing: config.charSpacing || 0 };
    }

    // Determine Fabric implementation to use
    const fabricImpl = config.fabricContext || fabric;
    const TextboxClass = fabricImpl.Textbox;

    // SSR Check
    if (!config.fabricContext && typeof document === 'undefined') {
        return { fontSize: config.minFontSize, charSpacing: config.charSpacing || 0 };
    }

    // 2. Create temporary textbox for measurement
    // We clone properties carefully to ensure accurate measurement
    const tempText = new TextboxClass(text, {
        width: targetWidth,
        fontFamily: config.fontFamily,
        fontWeight: config.fontWeight,
        fontStyle: config.fontStyle as 'normal' | 'italic',
        lineHeight: config.lineHeight,
        textAlign: config.textAlign,
        charSpacing: config.charSpacing || 0,
        splitByGrapheme: false,
        // Style properties
        paintFirst: (config.paintFirst as 'fill' | 'stroke') || 'fill',
        underline: config.underline,
        linethrough: config.linethrough,
        overline: config.overline,
        objectCaching: config.objectCaching,
    });

    /**
     * Check if a specific configuration fits within constraints
     */
    const checkFit = (fontSize: number, spacing: number, enforceMaxLines: boolean): boolean => {
        tempText.set({ fontSize, charSpacing: spacing });
        
        if (typeof tempText.initDimensions === 'function') {
            tempText.initDimensions();
        }
        
        const textHeight = tempText.height || 0;
        
        // Hard Height Constraint
        if (textHeight > targetHeight) {
            return false;
        }
        
        // Soft MaxLines Constraint
        if (enforceMaxLines && config.maxLines !== undefined) {
            const lineCount = (tempText as any).textLines?.length || (tempText as any)._textLines?.length || 1;
            if (lineCount > config.maxLines) {
                return false;
            }
        }
        
        return true;
    };

    /**
     * Binary search for optimal font size (Standard Fit)
     */
    const binarySearch = (enforceMaxLines: boolean): number => {
        let low = config.minFontSize;
        let high = config.maxFontSize;
        let bestFit = 0;
        let iterations = 0;
        const baseSpacing = config.charSpacing || 0;

        while (low <= high && iterations < 30) {
            const mid = Math.floor((low + high) / 2);
            
            if (checkFit(mid, baseSpacing, enforceMaxLines)) {
                bestFit = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
            iterations++;
        }
        return bestFit;
    };

    // PHASE 1: STANDARD FIT
    // Try to satisfy height AND maxLines
    let bestSize = binarySearch(true);
    
    // If strict match failed but we had maxLines, try ignoring maxLines (soft constraint)
    if (bestSize === 0 && config.maxLines !== undefined) {
        bestSize = binarySearch(false);
    }
    
    // If we found a fit in standard range, return it
    if (bestSize > 0) {
        return { fontSize: bestSize, charSpacing: config.charSpacing || 0 };
    }

    // PHASE 2: TRACKING COMPRESSION (Squish Mode)
    // If Min Size fails, try squeezing letters together at Min Size
    // Limit: Reduce spacing by up to 50 units (e.g. pixels in Fabric)
    const minSize = config.minFontSize;
    const baseSpacing = config.charSpacing || 0;
    
    // We only try this if Pass 1 failed (meaning minSize didn't fit)
    // Try reducing spacing by 1 pixel at a time
    for (let s = 1; s <= 50; s++) {
        const compressedSpacing = baseSpacing - s; // e.g. 0 -> -1
        if (checkFit(minSize, compressedSpacing, false)) { // Ignore maxLines in emergency
            return { fontSize: minSize, charSpacing: compressedSpacing };
        }
    }

    // PHASE 3: EMERGENCY SHRINK (The Hard Floor)
    // If compression failed, start shrinking font size below Min Size
    // Keep shrinking by 1px until we hit 6px floor
    const HARD_FLOOR = 6;
    for (let size = minSize - 1; size >= HARD_FLOOR; size--) {
        // Reset spacing to slight compression (-2) or zero? 
        // Let's keep slight compression (-10) to help it fit faster while staying readable
        const emergencySpacing = baseSpacing - 10; 
        if (checkFit(size, emergencySpacing, false)) {
            return { fontSize: size, charSpacing: emergencySpacing };
        }
    }

    // FALLBACK: Nothing fits even at 6px. Return 6px (overflow inevitable)
    return { fontSize: HARD_FLOOR, charSpacing: baseSpacing };
}

/**
 * Applies auto-fit to a Fabric Textbox.
 * 
 * @param fabricObj The Fabric Textbox object
 * @param targetWidth Fixed width (from element.width)
 * @param targetHeight Fixed height (from element.height)
 * @param minSize Minimum font size
 * @param maxSize Maximum font size
 * @param maxLines Soft max lines preference
 * @returns The new fontSize if changed, null otherwise
 */
export function applyAutoFit(
    fabricObj: fabric.FabricObject,
    targetWidth: number,
    targetHeight: number,
    minSize: number = 10,
    maxSize: number = 500,
    maxLines?: number
): number | null {
    if (!(fabricObj instanceof fabric.Textbox)) return null;
    
    // Guard: prevent re-entry
    if (_isAutoFitRunning) {
        return null;
    }
    
    _isAutoFitRunning = true;
    
    try {
        const text = fabricObj.text || '';
        if (!text.trim()) return null;

        const result = calculateBestFitFontSize(text, targetWidth, targetHeight, {
            fontFamily: fabricObj.fontFamily || 'Arial',
            fontWeight: fabricObj.fontWeight || 'normal',
            fontStyle: fabricObj.fontStyle || 'normal',
            lineHeight: fabricObj.lineHeight || 1.2,
            textAlign: fabricObj.textAlign || 'left',
            charSpacing: fabricObj.charSpacing || 0,
            minFontSize: minSize,
            maxFontSize: maxSize,
            maxLines: maxLines,
            
            // Pass style properties
            paintFirst: fabricObj.paintFirst || 'fill',
            underline: fabricObj.underline,
            linethrough: fabricObj.linethrough,
            overline: fabricObj.overline,
            objectCaching: fabricObj.objectCaching,
        });

        const hasChanged = fabricObj.fontSize !== result.fontSize || fabricObj.charSpacing !== result.charSpacing;
        
        // ALWAYS apply layout changes to force visual refresh
        fabricObj.set({
            fontSize: result.fontSize,
            charSpacing: result.charSpacing,
            width: targetWidth,
            scaleX: 1,
            scaleY: 1,
        });
        
        // Force re-layout
        fabricObj.initDimensions();
        fabricObj.setCoords();
        
        if (fabricObj.canvas) {
            fabricObj.canvas.requestRenderAll();
        }
        
        return hasChanged ? result.fontSize : null;
    } finally {
        _isAutoFitRunning = false;
    }
}


