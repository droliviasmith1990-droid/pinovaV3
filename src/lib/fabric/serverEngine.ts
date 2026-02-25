/**
 * Server-Side Rendering Engine for API
 * 
 * Uses fabric/node for Node.js server-side canvas operations.
 * This module is specifically for the /api/v1/generate endpoint.
 * 
 * IMPORTANT: Fonts must be registered BEFORE creating canvas objects.
 * Custom fonts are bundled via next.config.ts outputFileTracingIncludes.
 */

import * as fabricNode from 'fabric/node';
import { StaticCanvas, Rect, FabricImage, Textbox, Circle, Path } from 'fabric/node';
import { Element, TextElement, ImageElement, ShapeElement, FrameElement } from '@/types/editor';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as opentype from 'opentype.js';
import { replaceDynamicFields, applyTextTransform } from './text-shared';

// CRITICAL: Configure FontConfig for serverless environment (Vercel)
// Without this, you get: "Fontconfig error: Cannot load default config file"
// This causes custom fonts to render as box characters

// Point FontConfig to our custom config file
if (!process.env.FONTCONFIG_FILE) {
    const possibleConfigPaths = [
        path.resolve(process.cwd(), 'fonts.conf'),
        path.resolve(process.cwd(), '.next/server/fonts.conf'),
        '/var/task/fonts.conf',
    ];
    
    let configPath = null;
    for (const p of possibleConfigPaths) {
        if (fs.existsSync(p)) {
            configPath = p;
            break;
        }
    }
    
    if (configPath) {
        process.env.FONTCONFIG_FILE = configPath;
        console.log(`[ServerEngine] Using FontConfig file: ${configPath}`);
    } else {
        console.warn('[ServerEngine] fonts.conf not found! Font rendering may fail.');
    }
}

// Force use of FontConfig backend
if (!process.env.PANGOCAIRO_BACKEND) {
    process.env.PANGOCAIRO_BACKEND = 'fontconfig';
}

// Use require for canvas to avoid TypeScript type errors
// eslint-disable-next-line @typescript-eslint/no-require-imports
let canvasModule: any = null;
try {
    canvasModule = typeof require === 'function' ? eval('require')('canvas') : null;
} catch {
    console.warn('[ServerEngine] Canvas module not found (this is expected during build time)');
}
const { registerFont } = canvasModule || {};

// Types
export interface RenderConfig {
    width: number;
    height: number;
    backgroundColor?: string;
}

export interface FieldMapping {
    [templateField: string]: string;
}

// Import Auto-Fit calculation (shared with client)
import { calculateBestFitFontSize } from '../canvas/AutoFitText';

// Debug flag - set to false in production for performance
const DEBUG = false;

// Track registered fonts to avoid duplicate registration
const registeredFonts = new Set<string>();

/**
 * Register fonts from the bundled fonts directory
 * Must be called before creating any canvas/text objects
 */
function initializeFonts(): void {
    // Try multiple possible paths for the fonts directory
    // Vercel serverless functions have different paths than local dev
    const possiblePaths = [
        path.join(process.cwd(), 'public', 'fonts'),  // Local development
        path.join(process.cwd(), '.next', 'server', 'public', 'fonts'),  // Vercel bundled
        '/var/task/public/fonts',  // Vercel Lambda path
        '/var/task/.next/server/public/fonts', // Alternative Vercel path
    ];

    let fontsDir: string | null = null;
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            fontsDir = p;
            console.log(`[ServerEngine] Found fonts directory: ${p}`);
            break;
        }
    }

    if (!fontsDir) {
        console.warn('[ServerEngine] No fonts directory found, using system fonts only');
        return;
    }

    // Font family mapping: filename -> family name
    const fontMapping: Record<string, string> = {
        'Roboto-Regular.ttf': 'Roboto',
        'Roboto-Bold.ttf': 'Roboto',
        'OpenSans-Regular.ttf': 'Open Sans',
        'OpenSans-Bold.ttf': 'Open Sans',
        'Poppins-Regular.ttf': 'Poppins',
        'Poppins-Bold.ttf': 'Poppins',
        'Montserrat-Regular.ttf': 'Montserrat',
        'Montserrat-Bold.ttf': 'Montserrat',
        'Inter-Regular.ttf': 'Inter',
        'Inter-Bold.ttf': 'Inter',
    };

    try {
        const files = fs.readdirSync(fontsDir);
        for (const file of files) {
            if (!file.endsWith('.ttf') && !file.endsWith('.otf')) continue;
            
            const fontPath = path.join(fontsDir, file);
            const familyName = fontMapping[file] || file.replace(/[-_](Regular|Bold|Italic)?\.(ttf|otf)$/i, '');
            const weight = file.toLowerCase().includes('bold') ? 'bold' : 'normal';
            const style = file.toLowerCase().includes('italic') ? 'italic' : 'normal';
            
            const fontKey = `${familyName}-${weight}-${style}`;
            if (registeredFonts.has(fontKey)) continue;
            
            try {
                if (registerFont) {
                    registerFont(fontPath, {
                        family: familyName,
                        weight: weight,
                        style: style,
                    });
                    registeredFonts.add(fontKey);
                    console.log(`[ServerEngine:Check:Reg] Registered font: ${familyName} (${weight}, ${style}) from ${file}`);
                }
            } catch (err) {
                console.error(`[ServerEngine:Error:Reg] Failed to register font ${file}:`, err);
            }
        }
    } catch (err) {
        console.error('[ServerEngine] Error reading fonts directory:', err);
    }
}

// Initialize fonts on module load
initializeFonts();



/**
 * Download a Google Font from the official GitHub repository (raw content)
 * Fallback strategy for serverless environments where local files are missing
 * 
 * ENHANCED: Caches fonts to /tmp directory to persist across warm Lambda invocations.
 */
async function downloadGoogleFont(family: string, weight: string = 'normal', style: string = 'normal'): Promise<boolean> {
    const fontKey = `${family}-${weight}-${style}`;
    if (registeredFonts.has(fontKey)) return true;

    // Standardize cache directory
    const cacheDir = path.join(os.tmpdir(), 'font-cache');
    if (!fs.existsSync(cacheDir)) {
        try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) { /* ignore race */ }
    }

    // Map common font names to Google Fonts GitHub directory names
    const repoName = family.toLowerCase().replace(/\s+/g, '');
    
    let filenamePart = '-Regular';
    if (weight === 'bold') filenamePart = '-Bold';
    else if (weight === '300') filenamePart = '-Light';
    else if (weight === '500') filenamePart = '-Medium';
    else if (weight === '700') filenamePart = '-Bold';
    else if (weight === '900') filenamePart = '-Black';
    else if (weight === '100') filenamePart = '-Thin';
    
    if (style === 'italic') {
        if (filenamePart === '-Regular') filenamePart = '-Italic';
        else filenamePart += 'Italic';
    }

    const possibleFilenames = [
        `${family.replace(/\s+/g, '')}${filenamePart}.ttf`, // OpenSans-Regular.ttf
        `${family}${filenamePart}.ttf`,                   // Open Sans-Regular.ttf
        `${repoName}${filenamePart}.ttf`                  // opensans-Regular.ttf
    ];

    console.log(`[ServerEngine:Font] Checking cache for ${family} (${weight}, ${style})...`);

    // 1. Check Local Cache First
    for (const filename of possibleFilenames) {
        const cachedPath = path.join(cacheDir, filename);
        if (fs.existsSync(cachedPath)) {
            try {
                if (registerFont) {
                    registerFont(cachedPath, { family, weight, style });
                }
                registeredFonts.add(fontKey);
                console.log(`[ServerEngine:Font] CACHE HIT: Registered ${family} from ${cachedPath}`);
                return true;
            } catch {
                console.error(`[ServerEngine:Font] Corrupt cache file ${cachedPath}, deleting...`);
                try { fs.unlinkSync(cachedPath); } catch {}
            }
        }
    }

    // 2. Download if not cached
    const licenseTypes = ['ofl', 'apache', 'ufl'];
    console.log(`[ServerEngine:Font] Cache MISS. Attempting download for ${family}...`);

    for (const license of licenseTypes) {
        const baseUrl = `https://github.com/google/fonts/raw/main/${license}/${repoName}`;
        
        for (const filename of possibleFilenames) {
            const url = `${baseUrl}/${filename}`;
            const cachedPath = path.join(cacheDir, filename);
            
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const buffer = await response.arrayBuffer();
                    fs.writeFileSync(cachedPath, Buffer.from(buffer));
                    
                    if (registerFont) {
                        registerFont(cachedPath, { family, weight, style });
                    }
                    registeredFonts.add(fontKey);
                    
                    console.log(`[ServerEngine:Font] DOWNLOAD SUCCESS: ${family} saved to ${cachedPath} (License: ${license})`);
                    return true;
                }
            } catch {
                // Continue to next variant/license
            }
        }
    }

    console.warn(`[ServerEngine:Font] FAILED to download ${family}. Tried variants: ${possibleFilenames.join(', ')} across licenses: ${licenseTypes.join(', ')}`);
    return false;
}

/**
 * Get font with fallback - returns original font if registered, otherwise fallback
 * ENHANCED: Attempts dynamic download if font is missing
 */
async function getServerSafeFont(fontFamily: string, weight: string = 'normal', style: string = 'normal'): Promise<string> {
    // Check if font is registered
    const baseFamily = fontFamily.split(',')[0].trim().replace(/["']/g, '');
    
    // Check for bundled/registered fonts
    // Normalize weight/style to match registration keys
    const normWeight = weight === '700' || weight === 'bold' ? 'bold' : 'normal';
    const normStyle = style === 'italic' ? 'italic' : 'normal';
    
    const specificKey = `${baseFamily}-${normWeight}-${normStyle}`;
    const genericKey = `${baseFamily}-normal-normal`;

    if (registeredFonts.has(specificKey)) return baseFamily;
    if (registeredFonts.has(genericKey)) {
        // If we have regular but need bold, we can usually let OS/Canvas synthesize it, 
        // OR we should try to download the bold version
        if (normWeight === 'bold' && !registeredFonts.has(`${baseFamily}-bold-normal`)) {
             console.log(`[ServerEngine] Have Regular for "${baseFamily}", attempting to fetch Bold...`);
             // Fall through to download logic
        } else {
             return baseFamily;
        }
    }
    
    // Check for fonts loaded from URLs (pattern: familyName-url)
    if (registeredFonts.has(`${baseFamily}-url`)) {
        return baseFamily;
    }

    // [NEW] Attempt Dynamic Download
    // Only try for likely standard fonts (not system ones)
    const systemFonts = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia', 'sans-serif', 'serif'];
    if (!systemFonts.includes(baseFamily)) {
        const downloaded = await downloadGoogleFont(baseFamily, normWeight, normStyle);
        if (downloaded) return baseFamily;
        
        // If bold failed, try downloading regular as fallback
        if (normWeight !== 'normal') {
             const downloadedReg = await downloadGoogleFont(baseFamily, 'normal', normStyle);
             if (downloadedReg) return baseFamily;
        }
    }
    
    // Fallback to system fonts logic...
    const fallbacks: Record<string, string> = {
        'Roboto': 'sans-serif',
        'Open Sans': 'sans-serif',
        'Poppins': 'sans-serif',
        'Montserrat': 'sans-serif',
        'Inter': 'sans-serif',
        'Arial': 'sans-serif',
        'Helvetica': 'sans-serif',
    };
    
    for (const [key, value] of Object.entries(fallbacks)) {
        if (baseFamily.toLowerCase().includes(key.toLowerCase())) {
            console.log(`[ServerEngine] Font fallback: "${fontFamily}" -> "${value}"`);
            return value;
        }
    }
    
    console.log(`[ServerEngine] Font fallback: "${fontFamily}" -> "sans-serif" (default)`);
    return 'sans-serif';
}

/**
 * Download and register a font from URL for server-side rendering
 * @param fontUrl - URL to TTF/OTF font file
 * @param familyName - Font family name to register as
 * @returns True if font was loaded successfully
 */
async function loadFontFromUrl(fontUrl: string, familyName: string): Promise<boolean> {
    const fontKey = `${familyName}-url`;
    
    // Skip if already registered
    if (registeredFonts.has(fontKey)) {
        console.log(`[ServerEngine] Font already loaded from URL: ${familyName}`);
        return true;
    }
    
    try {
        console.log(`[ServerEngine] Downloading font from URL: ${familyName} (${fontUrl})`);
        
        // Download font file
        const response = await fetch(fontUrl);
        if (!response.ok) {
            console.error(`[ServerEngine] Failed to download font: HTTP ${response.status}`);
            return false;
        }
        
        let buffer = Buffer.from(await response.arrayBuffer());
        
        // Determine file extension from URL
        let extension = 'ttf';
        const lowerUrl = fontUrl.toLowerCase();
        if (lowerUrl.includes('.otf')) extension = 'otf';
        else if (lowerUrl.includes('.woff2')) extension = 'woff2';
        else if (lowerUrl.includes('.woff')) extension = 'woff';
        
        // CONVERSION: node-canvas only supports TTF/OTF.
        // If we have WOFF/WOFF2, we must convert it to TTF.
        if (extension === 'woff' || extension === 'woff2') {
            try {
                console.log(`[ServerEngine] Converting ${extension.toUpperCase()} to TTF for: ${familyName}`);
                
                // opentype.js .parse() accepts an ArrayBuffer. 
                // It creates an OpenType Font object which we can then export as TTF.
                const font = opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
                
                // Export as TTF (toArrayBuffer defaults to generating a TTF)
                const ttfBuffer = font.toArrayBuffer();
                buffer = Buffer.from(ttfBuffer);
                extension = 'ttf'; // Update extension to reflect conversion
                
                console.log(`[ServerEngine] Conversion successful for ${familyName}`);
            } catch (conversionError) {
                console.warn(`[ServerEngine] WOFF conversion failed for ${familyName}:`, conversionError);
                // Fallback: Try to use the original file, maybe node-canvas/fontconfig on this system supports it?
                // (Unlikely, but better than throwing immediately)
            }
        }
        
        // Write to temp file (registerFont requires file path)
        const tempPath = path.join(os.tmpdir(), `font_${Date.now()}_${familyName.replace(/\s+/g, '_')}.${extension}`);
        fs.writeFileSync(tempPath, buffer);
        
        // Register font with node-canvas
        // Extract basic weight/style from filename/URL to hint registerFont
        let weightStr = 'normal';
        let styleStr = 'normal';
        
        if (lowerUrl.includes('bold')) weightStr = 'bold';
        if (lowerUrl.includes('italic')) styleStr = 'italic';

        if (registerFont) {
            registerFont(tempPath, { 
                family: familyName,
                weight: weightStr,
                style: styleStr
            });
        }
        registeredFonts.add(fontKey);
        
        console.log(`[ServerEngine:Check:Net] Successfully loaded font from URL: ${familyName}`);
        return true;
    } catch (error) {
        console.error(`[ServerEngine] Failed to load font from URL:`, error);
        return false;
    }
}

/**
 * Extract unique font families from template elements
 */
function extractFontsFromElements(elements: Element[]): string[] {
    const fonts = new Set<string>();
    for (const el of elements) {
        if (el.type === 'text') {
            const textEl = el as TextElement;
            if (textEl.fontFamily) {
                // Get base family name (without fallbacks)
                const baseFamily = textEl.fontFamily.split(',')[0].trim().replace(/["']/g, '');
                fonts.add(baseFamily);
            }
        }
    }
    return Array.from(fonts);
}

// Cache for font URLs fetched from Supabase
const fontUrlCache = new Map<string, string>();

/**
 * Load custom fonts from Supabase for template elements
 * Fetches font URLs from database and registers them with node-canvas
 * 
 * @param elements - Template elements to extract fonts from
 * @param supabaseUrl - Supabase project URL
 * @param supabaseKey - Supabase service role key
 */
export async function loadCustomFontsForTemplate(
    elements: Element[],
    supabaseUrl: string,
    supabaseKey: string
): Promise<void> {
    const fontFamilies = extractFontsFromElements(elements);
    
    if (fontFamilies.length === 0) {
        console.log('[ServerEngine] No fonts to load from template');
        return;
    }
    
    console.log(`[ServerEngine] Loading custom fonts: ${fontFamilies.join(', ')}`);
    
    // Find fonts that aren't already registered
    const fontsToLoad = fontFamilies.filter(family => {
        const fontKey = `${family}-url`;
        return !registeredFonts.has(fontKey) && 
               !registeredFonts.has(`${family}-normal-normal`) &&
               !registeredFonts.has(`${family}-bold-normal`);
    });
    
    if (fontsToLoad.length === 0) {
        console.log('[ServerEngine] All fonts already registered');
        return;
    }
    
    // Fetch font URLs from Supabase
    for (const family of fontsToLoad) {
        // Check cache first
        if (fontUrlCache.has(family)) {
            const cachedUrl = fontUrlCache.get(family)!;
            await loadFontFromUrl(cachedUrl, family);
            continue;
        }
        
        try {
            // Query Supabase for font by family name
            const response = await fetch(
                `${supabaseUrl}/rest/v1/custom_fonts?family=eq.${encodeURIComponent(family)}&select=family,file_url`,
                {
                    headers: {
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${supabaseKey}`,
                    }
                }
            );
            
            if (!response.ok) {
                console.warn(`[ServerEngine] Failed to fetch font from DB: ${family}`);
                continue;
            }
            
            const fonts = await response.json();
            
            if (fonts && fonts.length > 0 && fonts[0].file_url) {
                const fontUrl = fonts[0].file_url;
                fontUrlCache.set(family, fontUrl);
                await loadFontFromUrl(fontUrl, family);
            } else {
                console.log(`[ServerEngine] Font not found in DB: ${family} (will use fallback)`);
            }
        } catch (error) {
            console.error(`[ServerEngine] Error fetching font ${family}:`, error);
        }
    }
}



/**
 * Prepare elements for server-side rendering
 * 1. Ensures fonts are downloaded/registered
 * 2. Updates element font families to the resolved safe font
 * 3. Returns new array of elements (does not mutate original)
 */
export async function prepareElementsForServerRendering(
    elements: Element[],
    supabaseUrl?: string,
    supabaseKey?: string
): Promise<Element[]> {
    const preparedElements = JSON.parse(JSON.stringify(elements)); // Deep clone
    
    // 1. Load custom fonts from Supabase if credentials provided
    if (supabaseUrl && supabaseKey) {
        await loadCustomFontsForTemplate(preparedElements, supabaseUrl, supabaseKey);
    }
    
    // 2. Process each element for Google Fonts / Fallbacks
    // Collect all unique fonts to process
    // We process sequentially to avoid overwhelming the network/fs with parallel downloads
    for (const el of preparedElements) {
        if (el.type === 'text') {
            const textEl = el as TextElement;
            if (textEl.fontFamily) {
                const fontWeight = textEl.fontWeight || (textEl.fontStyle?.includes('bold') ? 'bold' : 'normal');
                const fontStyle = textEl.fontStyle?.includes('italic') ? 'italic' : 'normal';
                
                // Ensure font is loaded and get the safe family name
                const safeFamily = await getServerSafeFont(textEl.fontFamily, String(fontWeight), fontStyle);
                
                // Update element to use the safe family
                textEl.fontFamily = safeFamily;
                
                // Also load custom font URL if present (legacy support)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const fontUrl = (textEl as any).fontUrl;
                if (fontUrl) {
                    await loadFontFromUrl(fontUrl, safeFamily);
                }
            }
        }
    }
    
    return preparedElements;
}

/**
 * Get dynamic image URL from element and row data
 */
function getDynamicImageUrl(element: ImageElement, rowData: Record<string, string>, fieldMapping: FieldMapping): string {
    const src = element.imageUrl || '';
    
    console.log(`[ServerEngine] getDynamicImageUrl for "${element.name}": isDynamic=${element.isDynamic}, dynamicSource="${element.dynamicSource}", imageUrl="${src?.substring(0, 60)}"`);
    
    if (element.isDynamic && element.dynamicSource) {
        const col = fieldMapping[element.dynamicSource];
        console.log(`[ServerEngine]   Mapped column: "${element.dynamicSource}" -> "${col}", value in rowData: "${rowData[col]?.substring(0, 60) || 'NOT FOUND'}"`);
        if (col && rowData[col]) {
            console.log(`[ServerEngine]   Using mapped value from rowData[${col}]`);
            return rowData[col];
        }
        if (rowData[element.dynamicSource]) {
            console.log(`[ServerEngine]   Using direct value from rowData[${element.dynamicSource}]`);
            return rowData[element.dynamicSource];
        }
        console.warn(`[ServerEngine]   Dynamic source "${element.dynamicSource}" not found in rowData! Available keys: ${Object.keys(rowData).join(', ')}`);
    }
    
    if (src.includes('{{')) {
        const resolved = replaceDynamicFields(src, rowData, fieldMapping);
        console.log(`[ServerEngine]   Replaced template fields: "${resolved.substring(0, 60)}"`);
        return resolved;
    }
    
    console.log(`[ServerEngine]   Using static imageUrl: "${src.substring(0, 60)}"`);
    return src;
}

/**
 * Rewrite MinIO public URLs to internal endpoint for server-side access.
 * The VPS worker can't reach its own public IP (e.g. 147.93.5.32:9000),
 * so we rewrite to the internal endpoint (e.g. localhost:9000).
 */
function rewriteStorageUrl(url: string): string {
    const publicUrl = process.env.STORAGE_PUBLIC_URL;
    const internalEndpoint = process.env.STORAGE_ENDPOINT;
    
    if (publicUrl && internalEndpoint && url.includes(publicUrl.replace(/^https?:\/\//, ''))) {
        // Strip protocol for comparison, then replace
        const publicBase = publicUrl.replace(/\/$/, '');
        const internalBase = internalEndpoint.replace(/\/$/, '');
        const rewritten = url.replace(publicBase, internalBase);
        console.log(`[ServerEngine] URL rewrite: ${url.substring(0, 60)} → ${rewritten.substring(0, 60)}`);
        return rewritten;
    }
    return url;
}

/**
 * Load image from URL (server-side)
 */
async function loadImageServer(url: string): Promise<FabricImage | null> {
    if (!url) return null;
    
    try {
        // Decode proxy URL if present
        let fetchUrl = url;
        if (url.startsWith('/api/proxy-image')) {
            const urlParams = new URLSearchParams(url.split('?')[1] || '');
            const originalUrl = urlParams.get('url');
            if (originalUrl) {
                fetchUrl = decodeURIComponent(originalUrl);
            }
        }
        
        // Rewrite MinIO public URLs to internal endpoint (VPS can't reach its own public IP)
        fetchUrl = rewriteStorageUrl(fetchUrl);
        
        // Fetch image data
        const response = await fetch(fetchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/*',
            },
        });
        
        if (!response.ok) {
            console.error(`[ServerEngine] Failed to fetch image: ${response.status} - ${fetchUrl.substring(0, 80)}`);
            return null;
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const contentType = response.headers.get('content-type') || 'image/png';
        const dataUrl = `data:${contentType};base64,${base64}`;
        
        // Create FabricImage from data URL
        const img = await FabricImage.fromURL(dataUrl);
        return img;
    } catch (error) {
        console.error(`[ServerEngine] Image load error:`, error);
        return null;
    }
}



/**
 * Calculate optimal font size to fit text within container (server-side)
 * Uses Fabric.js Textbox for ACCURATE measurement - same as client-side
 * Binary search finds the LARGEST font that fits within container height
 * 
 * Enhancements:
 * - 15px internal padding on all sides for visual breathing room
 * - Lower default maxFontSize (48px) for better visual consistency across pins
 */
/**
 * Local calculateFitFontSizeServer removed - imported from ../canvas/textUtils
 */

/**
 * Render a single element to the canvas
 */
async function renderElement(
    canvas: StaticCanvas,
    el: Element,
    rowData: Record<string, string>,
    fieldMapping: FieldMapping
): Promise<void> {
    if (!el.visible) return;

    const commonOptions = {
        left: el.x,
        top: el.y,
        angle: el.rotation || 0,
        opacity: el.opacity ?? 1,
        // Support originX/originY if present in element data (even if not in type)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        originX: (el as any).originX || 'left',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        originY: (el as any).originY || 'top',
    };

    if (el.type === 'text') {
        const textEl = el as TextElement;
        let text = textEl.text;
        
        console.log(`[ServerEngine] TEXT: name="${el.name}", original="${text?.substring(0, 50)}"`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        console.log(`[ServerEngine] TEXT: isDynamic=${'isDynamic' in textEl ? (textEl as any).isDynamic : false}`);
        console.log(`[ServerEngine] TEXT: fieldMapping=`, fieldMapping);
        console.log(`[ServerEngine] TEXT: rowData keys=`, Object.keys(rowData));
        
        // Replace dynamic fields
        text = replaceDynamicFields(text, rowData, fieldMapping);
        text = applyTextTransform(text, textEl.textTransform);
        
        console.log(`[ServerEngine] TEXT: final text="${text?.substring(0, 50)}"`);
        console.log(`[ServerEngine] TEXT: position x=${el.x}, y=${el.y}, width=${textEl.width}`);
        console.log(`[ServerEngine] TEXT: font=${textEl.fontFamily}, size=${textEl.fontSize}, fill=${textEl.fill}`);

        // Load custom font from URL if available (for server-side rendering)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fontUrl = (textEl as any).fontUrl;
        if (fontUrl && textEl.fontFamily) {
            console.log(`[ServerEngine] TEXT: Loading custom font from URL: ${textEl.fontFamily}`);
            await loadFontFromUrl(fontUrl, textEl.fontFamily);
        }

        // CRITICAL: Get safe font FIRST, use same font for measurement AND rendering
        // [UPDATE] Await the font resolution since it might involve a download
        const fontWeight = textEl.fontWeight || (textEl.fontStyle?.includes('bold') ? 'bold' : 'normal');
        const fontStyle = textEl.fontStyle?.includes('italic') ? 'italic' : 'normal';
        
        const safeFontFamily = await getServerSafeFont(textEl.fontFamily || 'Arial', String(fontWeight), fontStyle);
        
        // Calculate font size - use auto-fit if enabled
        let fontSize = textEl.fontSize || 16;
        let charSpacing = textEl.letterSpacing || 0;

        // CRITICAL: Ensure measurement uses EXACTLY the same font weight as rendering
        // Custom fonts often don't have bold variants mapped, so we force normal to avoid fallback to default fonts (which messes up width calc)
        const renderFontWeight = textEl.fontProvider === 'custom' ? 'normal' : String(fontWeight);
        
        // AUTO-FIT: Calculate optimal font size if enabled
        if (textEl.autoFit && textEl.width && textEl.height) {
            const fitResult = calculateBestFitFontSize(text, textEl.width, textEl.height, {
                fontFamily: safeFontFamily,
                fontWeight: renderFontWeight,
                fontStyle: fontStyle,
                lineHeight: textEl.lineHeight || 1.2,
                textAlign: textEl.align || 'left',
                charSpacing: charSpacing,
                minFontSize: textEl.minFontSize || 16,
                maxFontSize: textEl.maxFontSize || 500,
                maxLines: textEl.maxLines,
                
                // Style properties
                paintFirst: 'fill',
                underline: textEl.textDecoration === 'underline',
                linethrough: textEl.textDecoration === 'line-through',
                
                // Context for server-side execution
                fabricContext: fabricNode,
            });
            
            if (DEBUG) {
                console.log(`[ServerEngine] AUTO-FIT: "${text.substring(0, 30)}..." fontSize ${fontSize} -> ${fitResult.fontSize}, Spacing: ${fitResult.charSpacing}`);
            }
            fontSize = fitResult.fontSize;
            charSpacing = fitResult.charSpacing;
        }
        
        const textbox = new Textbox(text, {
            ...commonOptions,
            width: textEl.width,
            fontSize: fontSize,
            fontFamily: safeFontFamily,  // Use SAME font as measurement
            fill: textEl.fill || '#000000',
            textAlign: textEl.align || 'left',
            lineHeight: textEl.lineHeight || 1.2,
            charSpacing: charSpacing,
            // Use same standardized weight
            fontWeight: renderFontWeight,
            fontStyle: textEl.fontStyle?.includes('italic') ? 'italic' : 'normal',
            underline: textEl.textDecoration === 'underline',
            linethrough: textEl.textDecoration === 'line-through',
            // NOTE: splitByGrapheme removed to prevent ugly mid-word breaks like "CHI-CKEN"
            // Word-boundary wrapping is preferred for marketing text
        });
        // NOTE: clipPath removed - it caused display issues with Fabric.js 6.x
        // The calculateFitFontSizeServer function already ensures text fits within container

        // Smart Vertical Centering for Auto-Fit
        // When text shrinks significantly, center it vertically in the bounding box
        if (textEl.autoFit && textEl.height && textbox.height && textbox.height < textEl.height) {
            const diff = textEl.height - textbox.height;
            // Only apply centering offset if the element is top-aligned
            // Elements with originY='center' stay centered automatically when height changes
            if (diff > 0 && (textbox.originY === 'top' || !textbox.originY)) {
                // Shift top down by half the difference
                textbox.set('top', (textbox.top || 0) + (diff / 2));
                if (DEBUG) {
                    console.log(`[ServerEngine] Auto-Fit Centering: Shifted "${text.substring(0, 10)}..." down by ${diff / 2}px`);
                }
            }
        }

        canvas.add(textbox);
        console.log(`[ServerEngine] TEXT: Added textbox to canvas`);
    }
    else if (el.type === 'image') {
        const imageEl = el as ImageElement;
        
        console.log(`[ServerEngine] IMAGE: name="${el.name}", isDynamic=${imageEl.isDynamic}`);
        console.log(`[ServerEngine] IMAGE: dynamicSource="${imageEl.dynamicSource}", imageUrl="${imageEl.imageUrl?.substring(0, 60)}"`);
        
        const src = getDynamicImageUrl(imageEl, rowData, fieldMapping);
        
        console.log(`[ServerEngine] IMAGE: Resolved URL="${src?.substring(0, 100)}"`);
        
        const img = await loadImageServer(src);
        
        if (img) {
            const targetWidth = imageEl.width || img.width || 200;
            const targetHeight = imageEl.height || img.height || 200;
            const fitMode = imageEl.fitMode || (imageEl.isDynamic ? 'contain' : 'fill');
            
            const naturalWidth = img.width || 100;
            const naturalHeight = img.height || 100;
            
            console.log(`[ServerEngine] IMAGE: Loaded successfully, natural=${naturalWidth}x${naturalHeight}, target=${targetWidth}x${targetHeight}, fitMode=${fitMode}`);
            
            if (fitMode === 'fill') {
                img.set({
                    ...commonOptions,
                    scaleX: targetWidth / naturalWidth,
                    scaleY: targetHeight / naturalHeight,
                });
            } else if (fitMode === 'cover') {
                const scale = Math.max(targetWidth / naturalWidth, targetHeight / naturalHeight);
                const offsetX = ((naturalWidth * scale) - targetWidth) / 2;
                const offsetY = ((naturalHeight * scale) - targetHeight) / 2;
                
                img.set({
                    left: el.x - offsetX,
                    top: el.y - offsetY,
                    scaleX: scale,
                    scaleY: scale,
                    angle: el.rotation || 0,
                    opacity: el.opacity ?? 1,
                    clipPath: new Rect({
                        left: el.x,
                        top: el.y,
                        width: targetWidth,
                        height: targetHeight,
                        absolutePositioned: true,
                    }),
                });
            } else { // contain
                const scale = Math.min(targetWidth / naturalWidth, targetHeight / naturalHeight);
                const offsetX = (targetWidth - (naturalWidth * scale)) / 2;
                const offsetY = (targetHeight - (naturalHeight * scale)) / 2;
                
                img.set({
                    left: el.x + offsetX,
                    top: el.y + offsetY,
                    scaleX: scale,
                    scaleY: scale,
                    angle: el.rotation || 0,
                    opacity: el.opacity ?? 1,
                });
            }
            
            canvas.add(img);
            console.log(`[ServerEngine] IMAGE: Added to canvas at (${img.left}, ${img.top})`);
        } else {
            console.error(`[ServerEngine] IMAGE: FAILED to load "${el.name}" from ${src?.substring(0, 80)}`);
            // Placeholder for failed image
            const placeholder = new Rect({
                ...commonOptions,
                width: imageEl.width || 200,
                height: imageEl.height || 200,
                fill: '#fee2e2',
                stroke: '#dc2626',
                strokeWidth: 2,
            });
            canvas.add(placeholder);
        }
    }
    else if (el.type === 'shape') {
        const shapeEl = el as ShapeElement;
        
        if (shapeEl.shapeType === 'rect') {
            const rect = new Rect({
                ...commonOptions,
                width: shapeEl.width,
                height: shapeEl.height,
                fill: shapeEl.fill,
                stroke: shapeEl.stroke,
                strokeWidth: shapeEl.strokeWidth,
                rx: shapeEl.cornerRadius,
                ry: shapeEl.cornerRadius,
            });
            canvas.add(rect);
        }
        else if (shapeEl.shapeType === 'circle') {
            const circle = new Circle({
                ...commonOptions,
                radius: (shapeEl.width || 0) / 2,
                fill: shapeEl.fill,
                stroke: shapeEl.stroke,
                strokeWidth: shapeEl.strokeWidth,
            });
            canvas.add(circle);
        }
        else if (shapeEl.shapeType === 'path' && shapeEl.pathData) {
            const pathFill = shapeEl.fill === 'none' ? null : shapeEl.fill;
            const pathStroke = shapeEl.stroke === 'none' ? null : shapeEl.stroke;
            
            const path = new Path(shapeEl.pathData, {
                ...commonOptions,
                fill: pathFill || '#000000',
                stroke: pathStroke,
                strokeWidth: shapeEl.strokeWidth || 0,
            });
            canvas.add(path);
        }
    }
    else if (el.type === 'frame') {
        const frameEl = el as FrameElement;
        const frame = new Rect({
            ...commonOptions,
            width: frameEl.width,
            height: frameEl.height,
            fill: frameEl.fill || 'rgba(0,0,0,0.05)',
            stroke: frameEl.stroke || '#cccccc',
            strokeWidth: frameEl.strokeWidth || 1,
            strokeDashArray: [5, 5],
            rx: frameEl.cornerRadius,
            ry: frameEl.cornerRadius,
        });
        canvas.add(frame);
    }
}

/**
 * Render template to canvas (server-side version)
 */
export async function renderTemplateServer(
    canvas: StaticCanvas,
    elements: Element[],
    config: RenderConfig,
    rowData: Record<string, string> = {},
    fieldMapping: FieldMapping = {}
): Promise<void> {
    // Set background color
    if (config.backgroundColor) {
        canvas.backgroundColor = config.backgroundColor;
    }
    
    // Sort elements by zIndex (lower first = bottom of stack)
    const sortedElements = [...elements].sort((a, b) => a.zIndex - b.zIndex);
    
    if (DEBUG) {
        console.log(`[ServerEngine] Rendering ${sortedElements.length} elements`);
    }
    
    // Render each element
    for (const el of sortedElements) {
        await renderElement(canvas, el, rowData, fieldMapping);
    }
    
    // Render all
    canvas.renderAll();
}
