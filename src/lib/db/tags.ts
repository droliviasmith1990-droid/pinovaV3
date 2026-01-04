// Tag database operations
// Follows the same patterns as templates.ts and categories.ts

import { supabase, isSupabaseConfigured, getCurrentUserId } from '../supabase';
import { DbTag } from '@/types/database.types';


// ============================================
// Types for tag operations
// ============================================

/**
 * Data required to create a new tag
 */
export interface CreateTagData {
    name: string;
    description?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Generate a URL-friendly slug from a name
 * @param name - The name to convert
 * @returns URL-friendly slug (lowercase, hyphens for spaces)
 */
function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with hyphens
        .replace(/^-|-$/g, '');       // Remove leading/trailing hyphens
}

// ============================================
// Tag CRUD Operations
// ============================================

/**
 * Get all tags for the current user
 * @returns Array of tags ordered by name
 */
export async function getTags(): Promise<DbTag[]> {
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
        const { data, error } = await supabase
            .from('tags')
            .select('*')
            .eq('user_id', userId)
            .order('name', { ascending: true });

        if (error) {
            console.error('Error fetching tags:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('Error fetching tags:', error);
        return [];
    }
}

/**
 * Get a single tag by ID
 * @param id - Tag ID
 * @returns The tag or null if not found
 */
export async function getTagById(id: string): Promise<DbTag | null> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured');
        return null;
    }

    const userId = await getCurrentUserId();
    if (!userId) {
        console.warn('User not authenticated');
        return null;
    }

    try {
        const { data, error } = await supabase
            .from('tags')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)  // Ensure user owns the tag
            .single();

        if (error) {
            console.error('Error fetching tag:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error fetching tag:', error);
        return null;
    }
}

/**
 * Create a new tag
 * @param data - Tag data (name, description)
 * @returns The created tag or null on error
 */
export async function createTag(data: CreateTagData): Promise<DbTag | null> {
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
        const slug = generateSlug(data.name);

        const insertData = {
            user_id: userId,
            name: data.name,
            slug,
            description: data.description || null,
        };

        const { data: tag, error } = await supabase
            .from('tags')
            .insert(insertData)
            .select()
            .single();

        if (error) {
            console.error('Error creating tag:', error);
            return null;
        }



        return tag;
    } catch (error) {
        console.error('Error creating tag:', error);
        return null;
    }
}

/**
 * Update an existing tag
 * @param id - Tag ID
 * @param updates - Fields to update
 * @returns The updated tag or null on error
 */
export async function updateTag(
    id: string, 
    updates: Partial<CreateTagData>
): Promise<DbTag | null> {
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
        const updateData: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
        };

        // Add provided fields
        if (updates.name !== undefined) {
            updateData.name = updates.name;
            updateData.slug = generateSlug(updates.name);  // Regenerate slug
        }
        if (updates.description !== undefined) {
            updateData.description = updates.description || null;
        }

        const { data, error } = await supabase
            .from('tags')
            .update(updateData)
            .eq('id', id)
            .eq('user_id', userId)  // Ensure user owns the tag
            .select()
            .single();

        if (error) {
            console.error('Error updating tag:', error);
            return null;
        }



        return data;
    } catch (error) {
        console.error('Error updating tag:', error);
        return null;
    }
}

/**
 * Delete a tag
 * @param id - Tag ID to delete
 * @returns true on success, false on error
 * @note ON DELETE CASCADE on template_tags will remove associations
 */
export async function deleteTag(id: string): Promise<boolean> {
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
            .from('tags')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);  // Ensure user owns the tag

        if (error) {
            console.error('Error deleting tag:', error);
            return false;
        }



        return true;
    } catch (error) {
        console.error('Error deleting tag:', error);
        return false;
    }
}

/**
 * Get all tags assigned to a specific template
 * @param templateId - Template ID
 * @returns Array of tags
 */
export async function getTemplateTags(templateId: string): Promise<DbTag[]> {
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
        const { data, error } = await supabase
            .from('template_tags')
            .select(`
                tag_id,
                tags:tags(*)
            `)
            .eq('template_id', templateId);

        if (error) {
            console.error('Error fetching template tags:', error);
            return [];
        }

        // Extract tags from joined data - cast through unknown for type safety
        const tags = (data || [])
            .map(item => (item.tags as unknown) as DbTag | null)
            .filter((tag): tag is DbTag => tag !== null);

        return tags;
    } catch (error) {
        console.error('Error fetching template tags:', error);
        return [];
    }
}

/**
 * Assign tags to a template (replaces existing assignments)
 * @param templateId - Template ID
 * @param tagIds - Array of tag IDs to assign
 * @returns true on success, false on error
 */
export async function assignTagsToTemplate(
    templateId: string, 
    tagIds: string[]
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
        // Step 1: Delete existing tag assignments for this template
        const { error: deleteError } = await supabase
            .from('template_tags')
            .delete()
            .eq('template_id', templateId);

        if (deleteError) {
            console.error('Error removing existing tag assignments:', deleteError);
            return false;
        }

        // Step 2: Insert new assignments (if any)
        if (tagIds.length > 0) {
            const insertData = tagIds.map(tagId => ({
                template_id: templateId,
                tag_id: tagId,
            }));

            const { error: insertError } = await supabase
                .from('template_tags')
                .insert(insertData);

            if (insertError) {
                console.error('Error assigning tags to template:', insertError);
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error('Error assigning tags to template:', error);
        return false;
    }
}

/**
 * Search tags by name (for autocomplete)
 * @param query - Search query
 * @returns Array of matching tags (max 10)
 */
export async function searchTags(query: string): Promise<DbTag[]> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured');
        return [];
    }

    const userId = await getCurrentUserId();
    if (!userId) {
        console.warn('User not authenticated');
        return [];
    }

    if (!query.trim()) {
        return [];
    }

    try {
        const { data, error } = await supabase
            .from('tags')
            .select('*')
            .eq('user_id', userId)
            .ilike('name', `%${query}%`)
            .order('name', { ascending: true })
            .limit(10);

        if (error) {
            console.error('Error searching tags:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('Error searching tags:', error);
        return [];
    }
}

/**
 * Get tags with accurate template counts
 * @returns Array of tags with updated template_count
 */
export async function getTagsWithCount(): Promise<DbTag[]> {
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
        const { data, error } = await supabase
            .from('tags')
            .select(`
                *,
                template_tags:template_tags(count)
            `)
            .eq('user_id', userId)
            .order('name', { ascending: true });

        if (error) {
            console.error('Error fetching tags with count:', error);
            return [];
        }

        // Transform the result to include template_count from joined data
        const tagsWithCount = (data || []).map((tag) => {
            const templateTagsData = tag.template_tags as { count: number }[] | null;
            const count = templateTagsData?.[0]?.count ?? 0;
            
            return {
                ...tag,
                template_count: count,
                template_tags: undefined,
            } as DbTag;
        });

        return tagsWithCount;
    } catch (error) {
        console.error('Error fetching tags with count:', error);
        return [];
    }
}

/**
 * Add a single tag to a template
 * @param templateId - Template ID
 * @param tagId - Tag ID to add
 * @returns true on success, false on error
 */
export async function addTagToTemplate(
    templateId: string, 
    tagId: string
): Promise<boolean> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured');
        return false;
    }

    try {
        const { error } = await supabase
            .from('template_tags')
            .insert({
                template_id: templateId,
                tag_id: tagId,
            });

        if (error) {
            // Ignore duplicate key error (tag already assigned)
            if (error.code === '23505') {
                return true;
            }
            console.error('Error adding tag to template:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error adding tag to template:', error);
        return false;
    }
}

/**
 * Remove a single tag from a template
 * @param templateId - Template ID
 * @param tagId - Tag ID to remove
 * @returns true on success, false on error
 */
export async function removeTagFromTemplate(
    templateId: string, 
    tagId: string
): Promise<boolean> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured');
        return false;
    }

    try {
        const { error } = await supabase
            .from('template_tags')
            .delete()
            .eq('template_id', templateId)
            .eq('tag_id', tagId);

        if (error) {
            console.error('Error removing tag from template:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error removing tag from template:', error);
        return false;
    }
}
