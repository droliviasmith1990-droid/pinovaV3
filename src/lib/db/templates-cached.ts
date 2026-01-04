import { supabase, isSupabaseConfigured } from '../supabase';
import { TemplateListItem } from './templates/types';
import { cacheGet } from '../redis';
import 'server-only';

/**
 * Get public templates for the gallery (CACHED)
 * @returns Array of public templates
 */
export async function getPublicTemplates(): Promise<TemplateListItem[]> {
    if (!isSupabaseConfigured()) {
        console.warn('Supabase not configured');
        return [];
    }

    // Cache public templates for 30 minutes
    return cacheGet('templates:public', async () => {
        try {
            const { data: templates, error } = await supabase
                .from('templates')
                .select('id, short_id, name, thumbnail_url, category, category_id, is_featured, view_count, created_at, updated_at')
                .eq('is_public', true)
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) {
                console.error('Error fetching public templates:', error);
                return [];
            }

            return templates || [];
        } catch (error) {
            console.error('Error fetching public templates:', error);
            return [];
        }
    }, 1800); // 30 minutes
}
