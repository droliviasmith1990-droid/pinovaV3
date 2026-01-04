import { supabase } from '../supabase';
import { getCurrentUserId } from '../supabase';


// ============================================
// Types
// ============================================

export interface Font {
    id: string;
    user_id: string;
    family: string;
    file_url: string;
    format: 'ttf' | 'otf' | 'woff' | 'woff2';
    category: 'sans-serif' | 'serif' | 'display' | 'script' | 'handwriting' | 'monospace';
    file_size?: number;
    created_at: string;
    updated_at: string;
}

export interface FontInsert {
    family: string;
    file_url: string;
    format: Font['format'];
    category: Font['category'];
    file_size?: number;
}

// ============================================
// CRUD Operations
// ============================================

/**
 * Upload a font file to Supabase Storage and save metadata to DB
 * @param file - Font file to upload
 * @param family - Font family name
 * @param category - Font category
 * @returns Created font metadata
 */
export async function uploadFont(
    file: File,
    family: string,
    category: Font['category']
): Promise<Font | null> {
    const userId = await getCurrentUserId();
    if (!userId) {
        console.error('User not authenticated');
        return null;
    }

    // Determine format from file extension
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !['ttf', 'otf', 'woff', 'woff2'].includes(extension)) {
        console.error('Unsupported font format');
        return null;
    }

    const format = extension as Font['format'];

    // Upload to Supabase Storage
    const fileName = `${Date.now()}_${file.name}`;
    const storagePath = `fonts/${userId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
        .from('assets')
        .upload(storagePath, file, {
            cacheControl: '3600',
            upsert: false,
        });

    if (uploadError) {
        console.error('Font upload error:', uploadError);
        return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
        .from('assets')
        .getPublicUrl(storagePath);

    // Save metadata to database
    const fontData: FontInsert = {
        family,
        file_url: urlData.publicUrl,
        format,
        category,
        file_size: file.size,
    };

    const { data, error } = await supabase
        .from('custom_fonts')
        .insert({
            ...fontData,
            user_id: userId,
        })
        .select()
        .single();

    if (error) {
        console.error('Font DB insert error:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        console.error('Attempting to insert:', { ...fontData, user_id: userId });
        // Clean up uploaded file
        await supabase.storage.from('assets').remove([storagePath]);
        return null;
    }



    return data;
}

/**
 * Get all fonts for the current user (CACHED)
 * @returns Array of user's fonts
 */
export async function getFonts(): Promise<Font[]> {
    const userId = await getCurrentUserId();
    if (!userId) return [];

    try {
        const { data, error } = await supabase
            .from('custom_fonts')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching fonts:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('Error fetching fonts:', error);
        return [];
    }
}

/**
 * Get fonts grouped by category
 * @returns Object with categories as keys and font arrays as values
 */
export async function getFontsByCategory(): Promise<Record<string, Font[]>> {
    const fonts = await getFonts();
    const grouped: Record<string, Font[]> = {
        'sans-serif': [],
        'serif': [],
        'display': [],
        'script': [],
        'handwriting': [],
        'monospace': [],
    };

    fonts.forEach(font => {
        grouped[font.category].push(font);
    });

    return grouped;
}

/**
 * Delete a font and its file from storage
 * @param fontId - ID of font to delete
 * @returns Success status
 */
export async function deleteFont(fontId: string): Promise<boolean> {
    const userId = await getCurrentUserId();
    if (!userId) return false;

    // Get font data first to retrieve file URL
    const { data: font, error: fetchError } = await supabase
        .from('custom_fonts')
        .select('file_url, user_id')
        .eq('id', fontId)
        .single();

    if (fetchError || !font || font.user_id !== userId) {
        console.error('Font not found or unauthorized');
        return false;
    }

    // Extract storage path from URL
    const urlParts = font.file_url.split('/storage/v1/object/public/assets/');
    if (urlParts.length > 1) {
        const storagePath = urlParts[1];
        await supabase.storage.from('assets').remove([storagePath]);
    }

    // Delete from database
    const { error: deleteError } = await supabase
        .from('custom_fonts')
        .delete()
        .eq('id', fontId)
        .eq('user_id', userId);

    if (deleteError) {
        console.error('Font deletion error:', deleteError);
        return false;
    }



    return true;
}

/**
 * Load a custom font into the browser's FontFace API
 * @param font - Font metadata
 */
export async function loadCustomFont(font: Font): Promise<void> {
    try {
        const fontFace = new FontFace(font.family, `url(${font.file_url})`);
        await fontFace.load();
        document.fonts.add(fontFace);
    } catch (error) {
        console.error('Failed to load custom font:', error);
    }
}
