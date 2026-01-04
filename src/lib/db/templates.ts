// Template database operations
import { supabase, isSupabaseConfigured, getCurrentUserId } from '../supabase';
import { DbTemplate, DbCategory, DbTag } from '@/types/database.types';
import { Element } from '@/types/editor';
import { assignTagsToTemplate } from './tags';
import { customAlphabet } from 'nanoid';


// Configuration
const SHORT_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SHORT_ID_LENGTH = 8;
const nanoid = customAlphabet(SHORT_ID_ALPHABET, SHORT_ID_LENGTH);

// Import shared types from templates module
import type {
    SaveTemplateData,
    TemplateListItem,
    TemplateFilters,
    TemplateMetadata,
} from './templates/types';

// Re-export types for backwards compatibility
export type {
    SaveTemplateData,
    TemplateListItem,
    TemplateFilters,
    TemplateMetadata,
} from './templates/types';

// Note: TemplateWithElements is defined below as it extends TemplateListItem

/**
 * Generate a unique short ID for a template
 * Format: TMPL-{8 chars}
 */
export function generateShortId(): string {
    return `TMPL-${nanoid()}`;
}

/**
 * Get a template by its short ID (Server-side compatible)
 * @param shortId The short ID to look up
 * @param client Optional Supabase client (defaults to global client)
 */
export async function getTemplateByShortId(
    shortId: string,
    client = supabase
): Promise<DbTemplate | null> {
    try {
        const { data, error } = await client
            .from('templates')
            .select('*')
            .eq('short_id', shortId)
            .single();

        if (error) {
            console.error('Error fetching template by short ID:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error fetching template by short ID:', error);
        return null;
    }
}

// ============================================
// Template Name Helpers
// ============================================

/**
 * Check if a template with the given name already exists
 * @param name Template name to check
 * @param excludeId Optional template ID to exclude (for editing existing template)
 * @returns The existing template ID if found, null otherwise
 */
export async function checkTemplateNameExists(
    name: string,
    excludeId?: string
): Promise<{ exists: boolean; existingId?: string }> {
    if (!isSupabaseConfigured()) {
        return { exists: false };
    }

    const userId = await getCurrentUserId();
    if (!userId) {
        return { exists: false };
    }

    try {
        let query = supabase
            .from('templates')
            .select('id')
            .eq('user_id', userId)
            .ilike('name', name); // Case-insensitive match

        if (excludeId) {
            query = query.neq('id', excludeId);
        }

        const { data, error } = await query.limit(1);

        if (error) {
            console.error('Error checking template name:', error);
            return { exists: false };
        }

        if (data && data.length > 0) {
            return { exists: true, existingId: data[0].id };
        }

        return { exists: false };
    } catch (error) {
        console.error('Error checking template name:', error);
        return { exists: false };
    }
}

// ============================================
// Template CRUD Operations
// ============================================

/**
 * Save a template (insert or update)
 * @param data Template data to save
 * @returns The saved template or null on error
 */
export async function saveTemplate(data: SaveTemplateData): Promise<DbTemplate | null> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured, skipping template save');
        return null;
    }

    const userId = await getCurrentUserId();
    if (!userId) {
        console.error('User not authenticated');
        return null;
    }

    try {
        // BUGFIX: Sanitize elements to remove any non-serializable properties
        // This prevents database errors from internal Fabric.js metadata
        const sanitizedElements = data.elements ? JSON.parse(JSON.stringify(data.elements)) : [];
        
        if (data.id) {
            // Update existing template
            // FIX: Only include fields that are explicitly provided
            // This prevents auto-save from overwriting category/tags metadata
            const updateData: Record<string, unknown> = {
                name: data.name,
                canvas_size: data.canvas_size,
                background_color: data.background_color,
                elements: sanitizedElements,
                updated_at: new Date().toISOString(),
            };

            // Only update optional fields if they're explicitly provided
            if (data.description !== undefined) updateData.description = data.description;
            if (data.thumbnail_url !== undefined) updateData.thumbnail_url = data.thumbnail_url;
            if (data.category !== undefined) updateData.category = data.category;
            if (data.category_id !== undefined) updateData.category_id = data.category_id;
            if (data.is_public !== undefined) updateData.is_public = data.is_public;
            if (data.is_featured !== undefined) updateData.is_featured = data.is_featured;

            const { data: template, error } = await supabase
                .from('templates')
                .update(updateData)
                .eq('id', data.id)
                .eq('user_id', userId) // Ensure user owns the template
                .select()
                .single();

            if (error) {
                console.error('Error updating template:', error);
                console.error('Template data that failed:', {
                    id: data.id,
                    elementCount: sanitizedElements.length,
                    elementsSize: JSON.stringify(sanitizedElements).length,
                });
                return null;
            }

            return template;
        } else {
            // Insert new template
            const insertData = {
                user_id: userId,
                name: data.name,
                short_id: generateShortId(), // Auto-generate short ID
                description: data.description || null,
                canvas_size: data.canvas_size,
                background_color: data.background_color,
                elements: sanitizedElements,
                thumbnail_url: data.thumbnail_url || null,
                category: data.category || null,
                category_id: data.category_id || null,
                is_public: data.is_public ?? false,
                is_featured: data.is_featured ?? false,
            };

            const { data: template, error } = await supabase
                .from('templates')
                .insert(insertData)
                .select()
                .single();

            if (error) {
                console.error('Error inserting template:', error);
                console.error('Template data that failed:', {
                    name: data.name,
                    elementCount: sanitizedElements.length,
                    elementsSize: JSON.stringify(sanitizedElements).length,
                });
                return null;
            }

            return template;
        }
    } catch (error) {
        console.error('Error saving template:', error);
        if (error instanceof Error) {
            console.error('Error details:', error.message, error.stack);
        }
        return null;
    }
}

/**
 * Get all templates for the current user
 * @returns Array of templates or empty array on error
 */
export async function getTemplates(): Promise<TemplateListItem[]> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured');
        return [];
    }

    const userId = await getCurrentUserId();
    if (!userId) {
        console.warn('User not authenticated');
        return [];
    }

    try {
        const { data: templates, error } = await supabase
            .from('templates')
            .select('id, short_id, name, thumbnail_url, category, category_id, is_featured, view_count, created_at, updated_at')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false });

        if (error) {
            console.error('Error fetching templates:', error);
            return [];
        }

        return templates || [];
    } catch (error) {
        console.error('Error fetching templates:', error);
        return [];
    }
}

/**
 * Template with elements for dynamic data extraction
 */
export interface TemplateWithElements extends TemplateListItem {
    elements: Element[];
}

/**
 * Get templates with elements included for dynamic data extraction
 * This is an optimized single-query version that avoids N+1 database calls
 * @param filters - Optional filter criteria
 * @returns Array of templates with elements
 */
export async function getTemplatesWithElements(
    filters?: TemplateFilters
): Promise<TemplateWithElements[]> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured');
        return [];
    }

    const userId = await getCurrentUserId();
    if (!userId && !filters?.isPublic) {
        console.warn('User not authenticated');
        return [];
    }

    try {
        // If filtering by tags, first get template IDs that have those tags
        let filteredTemplateIds: string[] | null = null;
        
        if (filters?.tagIds && filters.tagIds.length > 0) {
            const { data: taggedTemplates, error: tagError } = await supabase
                .from('template_tags')
                .select('template_id')
                .in('tag_id', filters.tagIds);

            if (tagError) {
                console.error('Error fetching template tags:', tagError);
                return [];
            }

            filteredTemplateIds = [...new Set(
                (taggedTemplates || []).map(t => t.template_id)
            )];

            if (filteredTemplateIds.length === 0) {
                return [];
            }
        }

        // Build query including elements for dynamic data
        let query = supabase
            .from('templates')
            .select(`
                id, short_id, name, thumbnail_url, category, category_id, 
                is_featured, view_count, created_at, updated_at,
                elements,
                category_data:categories(id, name, slug, icon, color)
            `);

        // Apply filters
        if (filters?.isPublic) {
            query = query.eq('is_public', true);
        } else if (userId) {
            query = query.eq('user_id', userId);
        }

        if (filters?.categoryId) {
            query = query.eq('category_id', filters.categoryId);
        }

        if (filters?.isFeatured) {
            query = query.eq('is_featured', true);
        }

        if (filters?.search) {
            query = query.ilike('name', `%${filters.search}%`);
        }

        if (filteredTemplateIds) {
            query = query.in('id', filteredTemplateIds);
        }

        query = query.order('updated_at', { ascending: false });

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching templates with elements:', error);
            return [];
        }

        // Transform the response
        const templates = (data || []).map(t => ({
            id: t.id,
            short_id: t.short_id,
            name: t.name,
            thumbnail_url: t.thumbnail_url,
            category: t.category,
            category_id: t.category_id,
            is_featured: t.is_featured,
            view_count: t.view_count,
            created_at: t.created_at,
            updated_at: t.updated_at,
            elements: (t.elements as Element[]) || [],
            category_data: Array.isArray(t.category_data) 
                ? t.category_data[0] as DbCategory | null
                : t.category_data as DbCategory | null,
        })) as TemplateWithElements[];

        return templates;
    } catch (error) {
        console.error('Error fetching templates with elements:', error);
        return [];
    }
}

/**
 * Get public templates for the gallery (CACHED)
 * @returns Array of public templates
 */


/**
 * Get a single template by ID with full data
 * @param templateId Template ID
 * @returns Full template data or null
 */
export async function getTemplate(templateId: string): Promise<DbTemplate | null> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured');
        return null;
    }

    try {
        const { data: template, error } = await supabase
            .from('templates')
            .select('*')
            .eq('id', templateId)
            .single();

        if (error) {
            console.error('Error fetching template:', error);
            return null;
        }

        return template;
    } catch (error) {
        console.error('Error fetching template:', error);
        return null;
    }
}

/**
 * Delete a template
 * @param templateId Template ID to delete
 * @returns true on success, false on error
 */
export async function deleteTemplate(templateId: string): Promise<boolean> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured');
        return false;
    }

    const userId = await getCurrentUserId();
    if (!userId) {
        console.error('User not authenticated');
        return false;
    }

    try {
        const { error } = await supabase
            .from('templates')
            .delete()
            .eq('id', templateId)
            .eq('user_id', userId); // Ensure user owns the template

        if (error) {
            console.error('Error deleting template:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error deleting template:', error);
        return false;
    }
}

/**
 * Duplicate a template
 * @param templateId Template ID to duplicate
 * @param newName Optional custom name for the duplicate
 * @returns The duplicated template or null on error
 */
export async function duplicateTemplate(templateId: string, newName?: string): Promise<DbTemplate | null> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured');
        return null;
    }

    const userId = await getCurrentUserId();
    if (!userId) {
        console.error('User not authenticated');
        return null;
    }

    try {
        // First, get the original template
        const original = await getTemplate(templateId);
        if (!original) {
            console.error('Original template not found');
            return null;
        }

        // Generate unique name if not provided
        let finalName = newName;
        if (!finalName) {
            finalName = await generateUniqueCopyName(original.name);
        }

        // Create a duplicate with the new name
        const duplicateData: SaveTemplateData = {
            name: finalName,
            // short_id will be generated automatically by saveTemplate
            description: original.description || undefined,
            canvas_size: original.canvas_size,
            background_color: original.background_color,
            elements: original.elements,
            category: original.category || undefined,
            category_id: original.category_id || undefined,
            is_public: false, // Duplicates are private by default
        };

        return await saveTemplate(duplicateData);
    } catch (error) {
        console.error('Error duplicating template:', error);
        return null;
    }
}

/**
 * Generate a unique copy name for a template
 * Handles name conflicts by appending (Copy), (Copy 2), (Copy 3), etc.
 * @param originalName - Original template name
 * @returns Unique name for the copy
 */
async function generateUniqueCopyName(originalName: string): Promise<string> {
    // Try "{Name} (Copy)" first
    let copyName = `${originalName} (Copy)`;
    let result = await checkTemplateNameExists(copyName);
    
    if (!result.exists) {
        return copyName;
    }
    
    // Try "{Name} (Copy 2)", "{Name} (Copy 3)", etc.
    let copyNumber = 2;
    const maxAttempts = 100; // Prevent infinite loop
    
    while (copyNumber <= maxAttempts) {
        copyName = `${originalName} (Copy ${copyNumber})`;
        result = await checkTemplateNameExists(copyName);
        
        if (!result.exists) {
            return copyName;
        }
        copyNumber++;
    }
    
    // Fallback: append timestamp
    return `${originalName} (Copy ${Date.now()})`;
}

// ============================================
// Filtered Template Queries
// ============================================

/**
 * Get templates with optional filters
 * @param filters - Filter criteria (category, tags, search, etc.)
 * @returns Filtered array of templates with category data
 */
export async function getTemplatesFiltered(
    filters: TemplateFilters
): Promise<TemplateListItem[]> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured');
        return [];
    }

    const userId = await getCurrentUserId();
    if (!userId && !filters.isPublic) {
        console.warn('User not authenticated');
        return [];
    }

    try {
        // If filtering by tags, first get template IDs that have those tags
        let filteredTemplateIds: string[] | null = null;
        
        if (filters.tagIds && filters.tagIds.length > 0) {
            const { data: taggedTemplates, error: tagError } = await supabase
                .from('template_tags')
                .select('template_id')
                .in('tag_id', filters.tagIds);

            if (tagError) {
                console.error('Error fetching template tags:', tagError);
                return [];
            }

            // Get unique template IDs
            filteredTemplateIds = [...new Set(
                (taggedTemplates || []).map(t => t.template_id)
            )];

            // If no templates have the requested tags, return empty
            if (filteredTemplateIds.length === 0) {
                return [];
            }
        }

        // Build the main query with category join
        let query = supabase
            .from('templates')
            .select(`
                id, short_id, name, thumbnail_url, category, category_id, 
                is_featured, view_count, created_at, updated_at,
                category_data:categories(id, name, slug, icon, color)
            `);

        // Apply filters
        if (filters.isPublic) {
            query = query.eq('is_public', true);
        } else if (userId) {
            query = query.eq('user_id', userId);
        }

        if (filters.categoryId) {
            query = query.eq('category_id', filters.categoryId);
        }

        if (filters.isFeatured) {
            query = query.eq('is_featured', true);
        }

        if (filters.search) {
            query = query.ilike('name', `%${filters.search}%`);
        }

        if (filteredTemplateIds) {
            query = query.in('id', filteredTemplateIds);
        }

        // Order by updated_at
        query = query.order('updated_at', { ascending: false });

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching filtered templates:', error);
            return [];
        }

        // Transform the response to flatten category_data
        const templates = (data || []).map(t => ({
            ...t,
            category_data: Array.isArray(t.category_data) 
                ? t.category_data[0] as DbCategory | null
                : t.category_data as DbCategory | null,
        })) as TemplateListItem[];

        return templates;
    } catch (error) {
        console.error('Error fetching filtered templates:', error);
        return [];
    }
}

/**
 * Update template metadata (category, tags, featured status)
 * @param templateId - Template ID
 * @param metadata - Metadata fields to update
 * @returns true on success, false on error
 */
export async function updateTemplateMetadata(
    templateId: string,
    metadata: TemplateMetadata
): Promise<boolean> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured');
        return false;
    }

    const userId = await getCurrentUserId();
    if (!userId) {
        console.error('User not authenticated');
        return false;
    }

    try {
        // Build update object with only provided fields
        const updateData: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
        };

        if (metadata.name !== undefined) {
            updateData.name = metadata.name;
        }
        if (metadata.categoryId !== undefined) {
            updateData.category_id = metadata.categoryId;
        }
        if (metadata.isFeatured !== undefined) {
            updateData.is_featured = metadata.isFeatured;
        }
        if (metadata.description !== undefined) {
            updateData.description = metadata.description;
        }

        // Update template fields
        const { error } = await supabase
            .from('templates')
            .update(updateData)
            .eq('id', templateId)
            .eq('user_id', userId);

        if (error) {
            console.error('Error updating template metadata:', error);
            return false;
        }

        // Update tags if provided
        if (metadata.tagIds !== undefined) {
            const tagsSuccess = await assignTagsToTemplate(templateId, metadata.tagIds);
            if (!tagsSuccess) {
                console.error('Error updating template tags');
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error('Error updating template metadata:', error);
        return false;
    }
}

/**
 * Increment view count for a template
 * @param templateId - Template ID
 * @returns true on success, false on error
 */
export async function incrementViewCount(templateId: string): Promise<boolean> {
    if (!isSupabaseConfigured()) {
        return false;
    }

    try {
        const { error } = await supabase.rpc('increment_template_views', {
            template_id: templateId,
        });

        // If RPC doesn't exist, fallback to manual update
        if (error && error.message.includes('function')) {
            const { data: template } = await supabase
                .from('templates')
                .select('view_count')
                .eq('id', templateId)
                .single();

            if (template) {
                await supabase
                    .from('templates')
                    .update({ view_count: (template.view_count || 0) + 1 })
                    .eq('id', templateId);
            }
        }

        return true;
    } catch (error) {
        console.error('Error incrementing view count:', error);
        return false;
    }
}

/**
 * Get template with full category and tags data
 * @param templateId - Template ID
 * @returns Template with joined category and tags or null
 */
export async function getTemplateWithDetails(
    templateId: string
): Promise<DbTemplate | null> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured');
        return null;
    }

    try {
        // Get template with category
        const { data: template, error } = await supabase
            .from('templates')
            .select(`
                *,
                category_data:categories(*)
            `)
            .eq('id', templateId)
            .single();

        if (error) {
            console.error('Error fetching template with details:', error);
            return null;
        }

        // Get tags separately
        const { data: templateTags } = await supabase
            .from('template_tags')
            .select('tags(*)')
            .eq('template_id', templateId);

        // Combine the data
        const result: DbTemplate = {
            ...template,
            category_data: (template.category_data as unknown) as DbCategory | null,
            tags: (templateTags || [])
                .map(t => (t.tags as unknown) as DbTag | null)
                .filter((tag): tag is DbTag => tag !== null),
        };

        return result;
    } catch (error) {
        console.error('Error fetching template with details:', error);
        return null;
    }
}

