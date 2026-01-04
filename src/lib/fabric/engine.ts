import * as fabric from 'fabric';
import { Element, TextElement, ImageElement, ShapeElement, FrameElement } from '@/types/editor';
import { getImageCache } from '@/lib/canvas/ImagePreloadCache';
import { calculateBestFitFontSize } from '@/lib/canvas/AutoFitText';

// Debug flag for verbose logging - disabled in production for performance
const DEBUG_RENDER = process.env.NODE_ENV === 'development' || process.env.DEBUG_RENDER === 'true';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🚀 SERVER-SIDE CACHES - Reuse fetched images across renders
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Level 1: URL → base64 data URL OR Buffer (set by route.ts before batch)
let serverImageCache: Map<string, string | Buffer> | null = null;

// Level 2: URL → FabricImage object (populated on first load, cloned for reuse)
let fabricImageCache: Map<string, fabric.FabricImage> | null = null;

/**
 * MERGE new images into the server image cache (don't replace!)
 * This is critical for concurrent batch rendering - each batch adds its images
 * without overwriting images cached by other concurrent batches.
 */
export function setServerImageCache(cache: Map<string, string | Buffer>): void {
    // Initialize caches if they don't exist
    if (!serverImageCache) {
        serverImageCache = new Map();
    }
    if (!fabricImageCache) {
        fabricImageCache = new Map();
    }
    
    // MERGE new entries into existing cache (don't replace!)
    cache.forEach((value, key) => {
        serverImageCache!.set(key, value);
    });
}

export function clearServerImageCache(): void {
    serverImageCache = null;
    fabricImageCache = null;
}

export interface RenderConfig {
    width: number;
    height: number;
    backgroundColor?: string;
    interactive?: boolean;
}

export interface FieldMapping {
    [templateField: string]: string;
}

// --- Auto-Fit Text Calculation ---

// Internal padding for auto-fit text (prevents text from touching container edges)
// Local implementation removed in favor of shared utility
// See src/lib/canvas/textUtils.ts

// --- Helper Functions ---

function createErrorPlaceholder(width: number = 200, height: number = 200): fabric.Group {
    const rect = new fabric.Rect({ width, height, fill: '#fee2e2', stroke: '#dc2626', strokeWidth: 3 });
    const text = new fabric.Text('⚠ Image Failed', {
        fontSize: Math.min(width, height) * 0.08, fontFamily: 'Arial', fill: '#dc2626',
        originX: 'center', originY: 'center', left: width / 2, top: height / 2,
    });
    return new fabric.Group([rect, text], { width, height });
}

async function loadImageToCanvas(url: string, options: Partial<fabric.ImageProps> = {}): Promise<fabric.FabricObject> {
    const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
    if (!url) return createErrorPlaceholder(options.width as number, options.height as number);

    const tryLoad = async (urlToTry: string) => {
        const img = await fabric.FabricImage.fromURL(urlToTry, { crossOrigin: 'anonymous', ...options });
        if (!img || !img.width) throw new Error('Invalid image');
        return img;
    };

    // OPTIMIZATION: Check image cache first (for batch rendering)
    if (isBrowser) {
        const cache = getImageCache();
        const cachedImage = cache.get(url);
        
        if (cachedImage && cachedImage.complete && cachedImage.naturalWidth > 0) {
            try {
                // Create fabric image from cached HTMLImageElement
                const img = new fabric.FabricImage(cachedImage, { ...options });
                // Ensure the image is properly initialized
                if (img && img.width && img.width > 0) {
                    // Cache HIT - this is the fast path
                    return img;
                }
            } catch (error) {
                console.warn(`[Engine] Failed to create FabricImage from cache for ${url.substring(0, 60)}:`, error);
            }
        } else {
            // Cache MISS - log for debugging
            const stats = cache.getStats();
            if (stats.cached > 0) {
                console.log(`[Engine] Cache MISS for: ${url.substring(0, 80)} (cache has ${stats.cached} images)`);
            }
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🚀 LEVEL 2 CACHE: FabricImage object cache - DISABLED
    // Cloning FabricImages during parallel batch rendering causes race 
    // conditions ("Image given has not completed loading" errors).
    // Each pin now creates fresh FabricImages from cached data URLs.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // DISABLED: fabricImageCache cloning
    // if (!isBrowser && fabricImageCache) { ... }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🚀 LEVEL 1 CACHE: Data URL OR Buffer cache
    // This is slower than cloning but avoids race conditions
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (!isBrowser && serverImageCache) {
        const cachedData = serverImageCache.get(url);
        if (cachedData) {
            try {
                // OPTIMIZATION: Handle Raw Buffer (Skip Base64)
                if (typeof cachedData !== 'string') {
                    // Assume it's a Buffer (node-canvas compatible)
                    // We use the global.Image polyfill which accepts Buffer as src
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const img = new (global as any).Image();
                    img.src = cachedData;
                    
                    const fabricImg = new fabric.FabricImage(img, { ...options });
                    return fabricImg;
                }
                
                // Fallback for Data URL strings
                const img = await tryLoad(cachedData);
                // NOTE: Not caching FabricImage to avoid parallel rendering race conditions
                return img;
            } catch {
                console.warn(`[Engine] Data URL/Buffer cache load failed for: ${url.substring(0, 60)}`);
            }
        } else {
            console.warn(`[Engine] Cache MISS for: ${url.substring(0, 80)}`);
        }
    }

    // Node/Server Logic - fetch images directly (no CORS restrictions on server)
    if (!isBrowser) {
        try {
            // Handle proxy URLs on server - extract the original URL and fetch directly
            // Server doesn't have CORS restrictions, so we can fetch external images directly
            let fetchUrl = url;
            if (url.startsWith('/api/proxy-image')) {
                // Extract the original URL from the proxy URL
                const urlParams = new URLSearchParams(url.split('?')[1] || '');
                const originalUrl = urlParams.get('url');
                if (originalUrl) {
                    fetchUrl = decodeURIComponent(originalUrl);
                }
            }
            
            // Add browser-like headers to bypass CDN restrictions
            // Note: Some CDNs (like Midjourney) block server-side requests regardless of headers
            const response = await fetch(fetchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                },
            });
            if (!response.ok) {
                console.warn(`[Engine] Image fetch failed (${response.status}): ${fetchUrl.substring(0, 80)}`);
                throw new Error(`Failed to fetch image: ${response.status}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');
            const dataUrl = `data:${response.headers.get('content-type') || 'image/png'};base64,${base64}`;
            return await tryLoad(dataUrl);
        } catch (error) {
            console.error(`[Engine] Server image load failed for ${url.substring(0, 60)}:`, error);
            return createErrorPlaceholder(options.width as number, options.height as number);
        }
    }

    // Browser Proxy Logic
    // IMPORTANT: If URL is already a proxy URL or data URL, use it directly - no double-proxying!
    if (url.startsWith('/api/proxy-image') || url.startsWith('data:')) {
        try { return await tryLoad(url); }
        catch { return createErrorPlaceholder(options.width as number, options.height as number); }
    }
    
    const knownCorsBlockedDomains = ['amazonaws.com'];
    const needsProxy = knownCorsBlockedDomains.some(d => url.includes(d));

    if (needsProxy) {
        try { return await tryLoad(`/api/proxy-image?url=${encodeURIComponent(url)}`); }
        catch { /* Retry direct below */ }
    }

    try { return await tryLoad(url); }
    catch {
        try { return await tryLoad(`/api/proxy-image?url=${encodeURIComponent(url)}`); }
        catch { return createErrorPlaceholder(options.width as number, options.height as number); }
    }
}

function replaceDynamicFields(text: string, rowData: Record<string, string>, fieldMapping: FieldMapping): string {
    let result = text;
    const matches = text.match(/\{\{([^}]+)\}\}/g);
    if (matches) {
        matches.forEach((match) => {
            const fieldName = match.replace(/\{\{|\}\}/g, '').trim();
            const csvColumn = fieldMapping[fieldName];
            if (csvColumn && rowData[csvColumn] !== undefined) result = result.replace(match, rowData[csvColumn]);
            else result = result.replace(match, '');
        });
    }
    return result;
}

export function getDynamicImageUrl(element: ImageElement, rowData: Record<string, string>, fieldMapping: FieldMapping): string {
    const src = element.imageUrl || '';
    
    // For Canva backgrounds, use proxy ONLY if not on our storage
    // Now that CORS is enabled on Tebi, we can load directly
    if (element.isCanvaBackground && src && !src.includes('tebi.io') && !src.includes('public.blob.vercel-storage.com')) {
        // If src is already a proxy URL, return as-is
        if (src.startsWith('/api/proxy-image')) {
            return src;
        }
        // If src is a data URL, return as-is (no proxy needed)
        if (src.startsWith('data:')) {
            return src;
        }
        // Otherwise, proxy the URL (encoding only if not already encoded)
        const needsEncoding = !src.includes('%3A') && !src.includes('%2F');
        return `/api/proxy-image?url=${needsEncoding ? encodeURIComponent(src) : src}`;
    }

    if (element.isDynamic && element.dynamicSource) {
        const col = fieldMapping[element.dynamicSource];
        if (col && rowData[col]) return rowData[col];
        if (rowData[element.dynamicSource]) return rowData[element.dynamicSource];
    }
    if (src.includes('{{')) return replaceDynamicFields(src, rowData, fieldMapping);
    return src;
}

/**
 * Apply text transformation (uppercase, lowercase, capitalize)
 * Phase 1 Typography Enhancement
 */
function applyTextTransform(
    text: string,
    transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize' | undefined
): string {
    if (!transform || transform === 'none') return text;
    
    switch (transform) {
        case 'uppercase':
            return text.toUpperCase();
        case 'lowercase':
            return text.toLowerCase();
        case 'capitalize':
            // Capitalize first letter of each word
            return text.replace(/\b\w/g, (char) => char.toUpperCase());
        default:
            return text;
    }
}

/**
 * Apply image fit mode (fill, cover, contain) to a fabric image
 * Extracted to avoid code duplication between cached and non-cached paths
 * 
 * @param img - Fabric image object
 * @param imageEl - Image element from template
 */
function applyImageFitMode(
  img: fabric.FabricImage,
  imageEl: ImageElement
): void {
  const targetWidth = imageEl.width || img.width;
  const targetHeight = imageEl.height || img.height;
  const fitMode = imageEl.fitMode || (imageEl.isDynamic ? 'contain' : 'fill');
  
  const naturalWidth = img.width || 100;
  const naturalHeight = img.height || 100;
  
  if (DEBUG_RENDER) {
    console.log(`[Render] Fit mode: ${fitMode}, target: ${targetWidth}x${targetHeight}, natural: ${naturalWidth}x${naturalHeight}`);
  }
  
  if (fitMode === 'fill') {
    // FILL MODE: Stretch image to exactly match template dimensions
    const scaleX = targetWidth / naturalWidth;
    const scaleY = targetHeight / naturalHeight;
    
    img.set({
      left: imageEl.x,
      top: imageEl.y,
      scaleX: scaleX,
      scaleY: scaleY,
      angle: imageEl.rotation || 0,
      opacity: imageEl.opacity ?? 1,
      originX: 'left',
      originY: 'top',
    });
    
    if (DEBUG_RENDER) {
      console.log(`[Render] Applied FILL: scaleX=${scaleX.toFixed(3)}, scaleY=${scaleY.toFixed(3)}`);
    }
    
  } else if (fitMode === 'cover') {
    // COVER MODE: Scale uniformly to cover, then CROP (more efficient than clipPath)
    // Calculating crop avoids rendering invisible pixels
    const scale = Math.max(targetWidth / naturalWidth, targetHeight / naturalHeight);
    
    const scaledWidth = naturalWidth * scale;
    const scaledHeight = naturalHeight * scale;
    
    // Calculate centering offsets
    const offsetX = (scaledWidth - targetWidth) / 2;
    const offsetY = (scaledHeight - targetHeight) / 2;
    
    img.set({
      left: imageEl.x,
      top: imageEl.y,
      scaleX: scale,
      scaleY: scale,
      angle: imageEl.rotation || 0,
      opacity: imageEl.opacity ?? 1,
      originX: 'left',
      originY: 'top',
      // CRITICAL OPTIMIZATION: Use cropX/cropY instead of clipPath
      // This tells the engine to only draw the visible source pixels
      cropX: offsetX / scale,
      cropY: offsetY / scale,
      width: targetWidth / scale,
      height: targetHeight / scale,
    });
    
    if (DEBUG_RENDER) {
      console.log(`[Render] Applied COVER (Optimized): scale=${scale.toFixed(3)}, crop=(${img.cropX?.toFixed(1)}, ${img.cropY?.toFixed(1)})`);
    }
    
  } else if (fitMode === 'contain') {
    // CONTAIN MODE: Scale uniformly to fit within frame
    const scale = Math.min(targetWidth / naturalWidth, targetHeight / naturalHeight);
    
    const scaledWidth = naturalWidth * scale;
    const scaledHeight = naturalHeight * scale;
    const offsetX = (targetWidth - scaledWidth) / 2;
    const offsetY = (targetHeight - scaledHeight) / 2;
    
    img.set({
      left: imageEl.x + offsetX,
      top: imageEl.y + offsetY,
      scaleX: scale,
      scaleY: scale,
      angle: imageEl.rotation || 0,
      opacity: imageEl.opacity ?? 1,
      originX: 'left',
      originY: 'top',
    });
    
    if (DEBUG_RENDER) {
      console.log(`[Render] Applied CONTAIN: scale=${scale.toFixed(3)}, centered with offset (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`);
    }
  }
  
  // Apply corner radius if specified (only for fill/contain, cover uses clipPath already)
  if (imageEl.cornerRadius && fitMode !== 'cover') {
    img.clipPath = new fabric.Rect({
      left: imageEl.x,
      top: imageEl.y,
      width: targetWidth,
      height: targetHeight,
      rx: imageEl.cornerRadius,
      ry: imageEl.cornerRadius,
      absolutePositioned: true,
    });
  }
}

/**
 * Pre-load all images in parallel BEFORE creating fabric objects
 * 
 * Why: Fabric object creation is fast (~5ms), image loading is slow (300ms)
 * Solution: Load all images first, then create fabric objects with cached images
 * 
 * @param elements - Template elements to scan for images
 * @param rowData - CSV row data for dynamic field substitution
 * @param fieldMapping - Template field to CSV column mapping
 * @returns Map<elementId, LoadedImage> - Cached images keyed by element ID
 */
async function preloadImages(
  elements: Element[],
  rowData: Record<string, string>,
  fieldMapping: FieldMapping
): Promise<Map<string, fabric.FabricImage>> {
  // STEP 1: Find all image elements
  const imageElements = elements.filter(el => el.type === 'image' && el.visible) as ImageElement[];
  
  if (imageElements.length === 0) {
    return new Map();
  }
  
  if (DEBUG_RENDER) {
    console.log(`[Render] Pre-loading ${imageElements.length} images in parallel...`);
  }
  
  // STEP 2: Build array of load promises (PARALLEL)
  const loadPromises = imageElements.map(async (el) => {
    const src = getDynamicImageUrl(el, rowData, fieldMapping);
    
    if (!src) {
      if (DEBUG_RENDER) {
        console.log(`[Render] Skipping image ${el.name} - no URL`);
      }
      return { elementId: el.id, image: null, error: null };
    }
    
    if (DEBUG_RENDER) {
      console.log(`[Render] Loading image from: ${src.substring(0, 80)}...`);
    }
    
    // Load image (this runs in PARALLEL for all images)
    const img = await loadImageToCanvas(src, {});
    
    if (DEBUG_RENDER) {
      console.log(`[Render] Image loaded successfully: ${el.name} (${img.width}x${img.height})`);
    }
    
    return { elementId: el.id, image: img as fabric.FabricImage, error: null };
  });
  
  // STEP 3: Wait for ALL images to load using allSettled for better error isolation
  // This ensures one failing image doesn't reject the entire promise
  const results = await Promise.allSettled(loadPromises);
  
  // STEP 4: Build cache map (filter out failures and nulls)
  const cache = new Map<string, fabric.FabricImage>();
  let failedCount = 0;
  
  results.forEach((result) => {
    if (result.status === 'fulfilled' && result.value.image) {
      cache.set(result.value.elementId, result.value.image);
    } else if (result.status === 'rejected') {
      failedCount++;
      if (DEBUG_RENDER) {
        console.error(`[Render] Image preload rejected:`, result.reason);
      }
    }
  });
  
  if (DEBUG_RENDER) {
    console.log(`[Render] Pre-load complete: ${cache.size}/${imageElements.length} images cached` +
      (failedCount > 0 ? `, ${failedCount} failed` : ''));
  }
  
  return cache;
}

// --- Fabric Object Creation ---
async function createFabricObject(
    el: Element,
    config: RenderConfig,
    rowData: Record<string, string>,
    fieldMapping: FieldMapping,
    imageCache?: Map<string, fabric.FabricImage> // ← NEW: Optional cache for parallel loading
): Promise<fabric.FabricObject | null> {
    if (!el.visible) return null;

    const commonOptions = {
        left: el.x, top: el.y, angle: el.rotation || 0, opacity: el.opacity ?? 1,
        selectable: config.interactive && !el.locked,
        evented: config.interactive && !el.locked,
    };

    let fabricObject: fabric.FabricObject | null = null;

    if (el.type === 'text') {
        const textEl = el as TextElement;
        let text = textEl.text;
        
        // Replace dynamic fields (e.g., {{name}} -> "John Smith")
        if (rowData && Object.keys(rowData).length > 0) {
            text = replaceDynamicFields(text, rowData, fieldMapping);
        }
        
        // Apply text transform AFTER field substitution
        text = applyTextTransform(text, textEl.textTransform);

        // Calculate font size (Auto-Fit or Fixed)
        let fontSize = textEl.fontSize || 24;
        let charSpacing = textEl.letterSpacing || 0;
        
        // Standardize font weight to avoid faux-bold measurement errors
        const renderFontWeight = textEl.fontProvider === 'custom' ? 'normal' : (textEl.fontWeight || 'normal');

        if (textEl.autoFit && textEl.width && textEl.height) {
            const fitResult = calculateBestFitFontSize(text, textEl.width, textEl.height, {
                fontFamily: textEl.fontFamily || 'Arial',
                fontWeight: renderFontWeight,
                fontStyle: (textEl.fontStyle as string) || 'normal',
                lineHeight: textEl.lineHeight || 1.2,
                textAlign: textEl.align || 'left',
                charSpacing: textEl.letterSpacing || 0,
                minFontSize: textEl.minFontSize || 10,
                maxFontSize: textEl.maxFontSize || 500,
                maxLines: textEl.maxLines, // Optional soft limit
            });
            fontSize = fitResult.fontSize;
            charSpacing = fitResult.charSpacing;
            
            if (DEBUG_RENDER && (fontSize !== textEl.fontSize || charSpacing !== (textEl.letterSpacing || 0))) {
                console.log(`[Engine] Auto-Fit applied: ${textEl.name} -> Size: ${fontSize}, Spacing: ${charSpacing}`);
            }
        }

        // MINIMAL: Just create a basic textbox
        const textbox = new fabric.Textbox(text, {
            ...commonOptions,
            width: textEl.width,
            fontSize: fontSize,
            fontFamily: textEl.fontFamily || 'Arial',
            fontWeight: renderFontWeight,
            fontStyle: textEl.fontStyle?.includes('italic') ? 'italic' : 'normal',
            fill: textEl.fill || '#000000',
            textAlign: textEl.align || 'left',
            lineHeight: textEl.lineHeight || 1.2,
            charSpacing: charSpacing, // Ensure spacing is applied (potentially compressed)
            underline: textEl.textDecoration === 'underline',
            linethrough: textEl.textDecoration === 'line-through',
        });

        fabricObject = textbox;
    }
    else if (el.type === 'image') {
        const imageEl = el as ImageElement;
        
        // STEP 1: Check cache first (images pre-loaded in parallel)
        if (imageCache && imageCache.has(el.id)) {
            // ✅ Use cached image (already loaded in parallel)
            const img = imageCache.get(el.id)!;
            
            if (DEBUG_RENDER) {
                console.log(`[Render] Using cached image for ${imageEl.name}`);
            }
            
            // Apply fit mode using extracted function
            applyImageFitMode(img, imageEl);
            
            fabricObject = img;
            
        } else {
            // ⚠️ FALLBACK: Load synchronously if not cached
            // This happens when:
            // 1. imageCache not provided (browser interactive mode)
            // 2. Image failed to load during preloadImages
            
            const src = getDynamicImageUrl(imageEl, rowData, fieldMapping);
            
            if (DEBUG_RENDER) {
                console.log(`[Render] Image ${imageEl.name}: URL resolved to:`, {
                    isDynamic: imageEl.isDynamic,
                    dynamicSource: imageEl.dynamicSource,
                    imageUrl: imageEl.imageUrl?.substring(0, 50),
                    resolvedSrc: src?.substring(0, 50),
                    hasUrl: !!src
                });
            }
            
            if (src) {
                if (DEBUG_RENDER) {
                    console.log(`[Render] Image ${imageEl.name} not in cache, loading synchronously from: ${src.substring(0, 80)}...`);
                }
                
                try {
                    const img = await loadImageToCanvas(src, {});
                    
                    if (DEBUG_RENDER) {
                        console.log(`[Render] Image loaded successfully: ${imageEl.name} (${img.width}x${img.height})`);
                    }
                    
                    // Apply fit mode using extracted function
                    applyImageFitMode(img as fabric.FabricImage, imageEl);
                    
                    fabricObject = img;
                    
                } catch (error) {
                    // Image load failed - create placeholder
                    console.error(`[Render] Failed to load image ${imageEl.name}:`, error);
                    fabricObject = new fabric.Rect({
                        ...commonOptions, 
                        width: imageEl.width || 200, 
                        height: imageEl.height || 200,
                        fill: '#fee2e2', 
                        stroke: '#dc2626', 
                        strokeWidth: 2
                    });
                }
            } else {
                // No URL - create placeholder
                if (DEBUG_RENDER) {
                    console.warn(`[Render] No URL for image ${imageEl.name}, creating placeholder`);
                }
                fabricObject = new fabric.Rect({
                    ...commonOptions, width: imageEl.width || 200, height: imageEl.height || 200,
                    fill: '#f3f4f6', stroke: '#d1d5db', strokeWidth: 2, strokeDashArray: [8, 4]
                });
            }
        }
    }
    else if (el.type === 'shape') {
        const shapeEl = el as ShapeElement;
        if (shapeEl.shapeType === 'rect') fabricObject = new fabric.Rect({ ...commonOptions, width: shapeEl.width, height: shapeEl.height, fill: shapeEl.fill, stroke: shapeEl.stroke, strokeWidth: shapeEl.strokeWidth, rx: shapeEl.cornerRadius, ry: shapeEl.cornerRadius });
        else if (shapeEl.shapeType === 'circle') fabricObject = new fabric.Circle({ ...commonOptions, radius: (shapeEl.width || 0) / 2, fill: shapeEl.fill, stroke: shapeEl.stroke, strokeWidth: shapeEl.strokeWidth });
        else if (shapeEl.shapeType === 'line') fabricObject = new fabric.Line(shapeEl.points as [number, number, number, number] || [0, 0, shapeEl.width, 0], { ...commonOptions, stroke: shapeEl.stroke, strokeWidth: shapeEl.strokeWidth });
        else if (shapeEl.shapeType === 'path') {
            // BUG-SVG-003 FIX: Validate pathData exists and is not empty
            if (!shapeEl.pathData || shapeEl.pathData.trim() === '') {
                console.warn(`[RenderEngine] Skipping path with empty data: ${el.name} (ID: ${el.id})`);
                return null;
            }

            // Handle 'none' fill - convert to null for Fabric.js transparency
            const pathFill = shapeEl.fill === 'none' ? null : (shapeEl.fill || '#000000');
            const pathStroke = shapeEl.stroke === 'none' ? null : (shapeEl.stroke || null);
            const pathStrokeWidth = shapeEl.strokeWidth || 0;

            // If no fill AND no stroke, default to black fill so path is visible
            const finalFill = (!pathFill && !pathStroke) ? '#000000' : pathFill;

            fabricObject = new fabric.Path(shapeEl.pathData, {
                angle: el.rotation || 0,
                opacity: el.opacity ?? 1,
                selectable: !el.locked,
                evented: !el.locked,
                fill: finalFill,
                stroke: pathStroke,
                strokeWidth: pathStrokeWidth
            });

            // CENTERING FIX: Set left/top to element.x/y directly
            // Element x/y contains the final centered position
            if (el.x !== 0 || el.y !== 0) {
                fabricObject.set({
                    left: el.x || 0,
                    top: el.y || 0
                });
            }
        }
    }
    else if (el.type === 'frame') {
        const frameEl = el as FrameElement;
        fabricObject = new fabric.Rect({
            ...commonOptions, width: frameEl.width, height: frameEl.height,
            fill: frameEl.fill || 'rgba(0,0,0,0.05)', stroke: frameEl.stroke || '#cccccc',
            strokeWidth: frameEl.strokeWidth || 1, strokeDashArray: [5, 5],
            rx: frameEl.cornerRadius, ry: frameEl.cornerRadius,
        });
    }

    if (fabricObject) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (fabricObject as any).elementId = el.id;
    }
    return fabricObject;
}

/**
 * ✅ INCREMENTAL RENDERER (v2.0)
 * - Preserves existing canvas objects and their positions
 * - Only adds NEW elements
 * - Only removes DELETED elements
 * - Never destroys unchanged elements
 * - 🚀 PHASE 1: Parallel image loading for 5-6x speedup
 */
export async function renderTemplate(
    canvas: fabric.StaticCanvas | fabric.Canvas,
    elements: Element[],
    config: RenderConfig,
    rowData: Record<string, string> = {},
    fieldMapping: FieldMapping = {}
): Promise<void> {

    // Safety: Check if canvas is disposed (server-safe check)
    // On server, we can't use getElement() as there's no DOM
    const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
    if (isBrowser && !canvas.getElement()) return;

    // 🔍 DEBUG: Canvas state before render
    if (DEBUG_RENDER) {
        console.log('[Render] 🎯 Canvas state BEFORE render:', {
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            viewportTransform: canvas.viewportTransform,
            backgroundColor: canvas.backgroundColor,
        });

        // 🔍 DEBUG: Element positions from template
        console.log('[Render] 📐 Elements from template (original positions):', elements.map(el => ({
            name: el.name,
            type: el.type,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
        })));
    }

    // 1. BUILD INDEX of existing canvas objects by elementId
    const existingObjectsMap = new Map<string, fabric.FabricObject>();
    canvas.getObjects().forEach(obj => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const id = (obj as any).elementId;
        if (id) existingObjectsMap.set(id, obj);
    });

    // 2. BUILD SET of incoming element IDs
    const incomingIds = new Set(elements.map(el => el.id));

    // 3. IDENTIFY NEW elements (in store but not on canvas)
    const newElements = elements.filter(el => !existingObjectsMap.has(el.id));

    // 4. IDENTIFY DELETED elements (on canvas but not in store)
    const deletedIds: string[] = [];
    existingObjectsMap.forEach((_, id) => {
        if (!incomingIds.has(id)) deletedIds.push(id);
    });

    // DEBUG LOGGING
    if (DEBUG_RENDER) {
        console.log(`[Render] Existing: ${existingObjectsMap.size}, Incoming: ${elements.length}, New: ${newElements.length}, Deleted: ${deletedIds.length}`);
    }

    // 5. REMOVE deleted objects
    deletedIds.forEach(id => {
        const obj = existingObjectsMap.get(id);
        if (obj) canvas.remove(obj);
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🚀 PHASE 1: Pre-load all images in PARALLEL
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const imageCache = await preloadImages(newElements, rowData, fieldMapping);

    // 6. ADD new objects sorted by zIndex (ascending = lower zIndex added first = bottom of stack)
    // IMPORTANT: We use pure z-index sorting. The Layers panel is the source of truth for layer order.
    // isCanvaBackground is just metadata - actual render order is determined by zIndex.
    const sortedNewElements = [...newElements].sort((a, b) => a.zIndex - b.zIndex);
    
    if (DEBUG_RENDER) {
        console.log(`[Render] ✅ Sorted element order (by zIndex ascending):`,
            sortedNewElements.map(el => `${el.name} (z:${el.zIndex})`).join(' → '));

        console.log(`[Render] About to add ${sortedNewElements.length} new elements:`, 
            sortedNewElements.map(el => `${el.name} (${el.type})`));
    }

    for (const el of sortedNewElements) {
        if (DEBUG_RENDER) {
            console.log(`[Render] Creating fabric object for: ${el.name} (${el.type}, id: ${el.id})`);
            console.log(`[Render] 📍 Template position for ${el.name}: x=${el.x}, y=${el.y}`);
        }
        
        // Pass imageCache to createFabricObject for parallel loading optimization
        const fabricObj = await createFabricObject(el, config, rowData, fieldMapping, imageCache);
        
        if (fabricObj) {
            if (DEBUG_RENDER) {
                // 🔍 DEBUG: Compare template Y vs Fabric Y
                console.log(`[Render] 🎯 Position comparison for ${el.name}:`, {
                    'Template Y': el.y,
                    'Fabric top': fabricObj.top,
                    'Difference': (fabricObj.top || 0) - el.y,
                    'Template X': el.x,
                    'Fabric left': fabricObj.left,
                    'ScaleX': fabricObj.scaleX,
                    'ScaleY': fabricObj.scaleY,
                });
            }
            
            canvas.add(fabricObj);
            
            if (DEBUG_RENDER) {
                console.log(`[Render] ✅ Added element: ${el.name} (${el.type})`);
            }
        } else {
            if (DEBUG_RENDER) {
                console.warn(`[Render] ❌ Failed to create fabric object for: ${el.name} (${el.type})`);
            }
        }
    }

    if (DEBUG_RENDER) {
        console.log(`[Render] Final canvas object count: ${canvas.getObjects().length}`);
        
        // 🔍 DEBUG: Final positions on canvas
        console.log('[Render] 📊 Final object positions on canvas:', canvas.getObjects().map(obj => ({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            name: (obj as any).name || 'unnamed',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            type: (obj as any).type,
            top: obj.top,
            left: obj.left,
            width: obj.width,
            height: obj.height,
        })));
    }

    // 7. UPDATE canvas dimensions and background (safe, doesn't affect objects)
    canvas.setDimensions({ width: config.width, height: config.height });
    if (config.backgroundColor) canvas.backgroundColor = config.backgroundColor;

    canvas.renderAll();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function exportToDataURL(canvas: fabric.StaticCanvas | fabric.Canvas, options: any = {}) {
    return canvas.toDataURL(options);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function exportToBlob(canvas: fabric.StaticCanvas | fabric.Canvas, options: any = {}) {
    // Default to PNG if not specified
    const format = options.format || 'png';
    const quality = options.quality || 1;
    const multiplier = options.multiplier || 1;
    
    // For JPEG, we need to ensure background color is set (no transparency)
    if (format === 'jpeg' && !canvas.backgroundColor) {
        canvas.backgroundColor = '#ffffff';
    }
    
    const dataUrl = canvas.toDataURL({
        format,
        quality,
        multiplier,
        enableRetinaScaling: false // FIX: Disable retina scaling to ensure output dimensions match requested size * multiplier, regardless of user's screen DPI
    });
    
    const response = await fetch(dataUrl);
    return response.blob();
}
