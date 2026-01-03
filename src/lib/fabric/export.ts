import * as fabric from 'fabric';

export interface ExportOptions {
    format?: 'png' | 'jpeg';
    quality?: number;
    multiplier?: number;
}

/**
 * Export a Fabric canvas to a Blob
 * Compatible with Fabric.js v6
 */
export async function exportToBlob(
    canvas: fabric.StaticCanvas | fabric.Canvas,
    options: ExportOptions = {}
): Promise<Blob> {
    const { format = 'png', quality = 1, multiplier = 1 } = options;

    // Create a data URL first (Fabric v6 standardized this)
    const dataUrl = canvas.toDataURL({
        format,
        quality,
        multiplier,
        enableRetinaScaling: true
    });

    // Convert Data URL to Blob
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return blob;
}
