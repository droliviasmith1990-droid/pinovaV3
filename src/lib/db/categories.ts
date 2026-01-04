// Category database operations
// Follows the same patterns as templates.ts

import { supabase, isSupabaseConfigured, getCurrentUserId } from '../supabase';
import { DbCategory } from '@/types/database.types';


// ============================================
// Types for category operations
// ============================================

/**
 * Data required to create a new category
 */
export interface CreateCategoryData {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
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
// Category CRUD Operations
// ============================================

/**
 * Get all categories for the current user (CACHED)
 * @returns Array of categories ordered by name
 */
export async function getCategories(): Promise<DbCategory[]> {
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
            .from('categories')
            .select('*')
            .eq('user_id', userId)
            .order('name', { ascending: true });

        if (error) {
            console.error('Error fetching categories:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('Error fetching categories:', error);
        return [];
    }
}

/**
 * Get a single category by ID
 * @param id - Category ID
 * @returns The category or null if not found
 */
export async function getCategoryById(id: string): Promise<DbCategory | null> {
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
            .from('categories')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)  // Ensure user owns the category
            .single();

        if (error) {
            console.error('Error fetching category:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error fetching category:', error);
        return null;
    }
}

/**
 * Create a new category
 * @param data - Category data (name, description, icon, color)
 * @returns The created category or null on error
 */
export async function createCategory(data: CreateCategoryData): Promise<DbCategory | null> {
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
            icon: data.icon || null,
            color: data.color || null,
        };

        const { data: category, error } = await supabase
            .from('categories')
            .insert(insertData)
            .select()
            .single();

        if (error) {
            console.error('Error creating category:', error);
            return null;
        }



        return category;
    } catch (error) {
        console.error('Error creating category:', error);
        return null;
    }
}

/**
 * Update an existing category
 * @param id - Category ID
 * @param updates - Fields to update
 * @returns The updated category or null on error
 */
export async function updateCategory(
    id: string, 
    updates: Partial<CreateCategoryData>
): Promise<DbCategory | null> {
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
        if (updates.icon !== undefined) {
            updateData.icon = updates.icon || null;
        }
        if (updates.color !== undefined) {
            updateData.color = updates.color || null;
        }

        const { data, error } = await supabase
            .from('categories')
            .update(updateData)
            .eq('id', id)
            .eq('user_id', userId)  // Ensure user owns the category
            .select()
            .single();

        if (error) {
            console.error('Error updating category:', error);
            return null;
        }



        return data;
    } catch (error) {
        console.error('Error updating category:', error);
        return null;
    }
}

/**
 * Delete a category
 * @param id - Category ID to delete
 * @returns true on success, false on error
 */
export async function deleteCategory(id: string): Promise<boolean> {
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
            .from('categories')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);  // Ensure user owns the category

        if (error) {
            console.error('Error deleting category:', error);
            return false;
        }



        return true;
    } catch (error) {
        console.error('Error deleting category:', error);
        return false;
    }
}

/**
 * Get categories with accurate template counts
 * Joins with templates table to get live counts
 * @returns Array of categories with updated template_count
 */
export async function getCategoriesWithCount(): Promise<DbCategory[]> {
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
        // Fetch categories with template count via aggregation
        const { data, error } = await supabase
            .from('categories')
            .select(`
                *,
                templates:templates(count)
            `)
            .eq('user_id', userId)
            .order('name', { ascending: true });

        if (error) {
            console.error('Error fetching categories with count:', error);
            return [];
        }

        // Transform the result to include template_count from joined data
        const categoriesWithCount = (data || []).map((cat) => {
            // Type the joined templates data
            const templatesData = cat.templates as { count: number }[] | null;
            const count = templatesData?.[0]?.count ?? 0;
            
            return {
                ...cat,
                template_count: count,
                templates: undefined,  // Remove the joined data
            } as DbCategory;
        });

        return categoriesWithCount;
    } catch (error) {
        console.error('Error fetching categories with count:', error);
        return [];
    }
}

/**
 * Get a category by its slug
 * @param slug - Category slug (URL-friendly name)
 * @returns The category or null if not found
 */
export async function getCategoryBySlug(slug: string): Promise<DbCategory | null> {
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
            .from('categories')
            .select('*')
            .eq('slug', slug)
            .eq('user_id', userId)
            .single();

        if (error) {
            // PGRST116 = no rows found (not an error for this use case)
            if (error.code !== 'PGRST116') {
                console.error('Error fetching category by slug:', error);
            }
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error fetching category by slug:', error);
        return null;
    }
}
