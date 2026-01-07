import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    getTemplates,
    getTemplate,
    deleteTemplate,
    duplicateTemplate,
    getTemplatesWithElements,
    TemplateFilters
} from '@/lib/db/templates';
import { isSupabaseConfigured } from '@/lib/supabase';
import { toast } from 'sonner';

/**
 * Query keys for templates
 */
export const templateKeys = {
    all: ['templates'] as const,
    lists: () => [...templateKeys.all, 'list'] as const,
    list: (filters: string) => [...templateKeys.lists(), { filters }] as const,
    details: () => [...templateKeys.all, 'detail'] as const,
    detail: (id: string) => [...templateKeys.details(), id] as const,
    withElements: (filters?: TemplateFilters) => [...templateKeys.lists(), 'with-elements', filters] as const,
};

/**
 * Fetch all templates for the current user
 */
export function useTemplates() {
    return useQuery({
        queryKey: templateKeys.lists(),
        queryFn: async () => {
            if (!isSupabaseConfigured()) {
                return [];
            }
            return getTemplates();
        },
        enabled: isSupabaseConfigured(),
    });
}

/**
 * Fetch templates with elements (heavy query)
 * Optimized with React Query caching
 */
export function useTemplatesWithElements(filters?: TemplateFilters) {
    const queryClient = useQueryClient();
    
    const query = useQuery({
        queryKey: templateKeys.withElements(filters),
        queryFn: async () => {
            if (!isSupabaseConfigured()) return [];
            return getTemplatesWithElements(filters);
        },
        enabled: isSupabaseConfigured(),
        staleTime: 1000 * 60 * 2, // Reduced to 2 minutes for fresher data
        gcTime: 1000 * 60 * 30,   // Keep in memory for 30 minutes
    });
    
    // Force invalidation function for manual refresh
    const invalidateAndRefetch = async () => {
        // Invalidate all template queries to force fresh fetch
        await queryClient.invalidateQueries({ queryKey: templateKeys.all });
        return query.refetch();
    };
    
    return {
        ...query,
        invalidateAndRefetch,
    };
}

/**
 * Fetch a single template by ID
 */
export function useTemplate(id: string | null) {
    return useQuery({
        queryKey: templateKeys.detail(id || ''),
        queryFn: async () => {
            if (!id) return null;
            return getTemplate(id);
        },
        enabled: !!id && isSupabaseConfigured(),
    });
}

/**
 * Delete a template
 */
export function useDeleteTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            await deleteTemplate(id);
            return id;
        },
        onSuccess: (deletedId) => {
            // Invalidate and refetch templates list
            queryClient.invalidateQueries({ queryKey: templateKeys.lists() });
            // Remove from cache
            queryClient.removeQueries({ queryKey: templateKeys.detail(deletedId) });
            toast.success('Template deleted');
        },
        onError: (error) => {
            console.error('Error deleting template:', error);
            toast.error('Failed to delete template');
        },
    });
}

/**
 * Duplicate a template
 */
export function useDuplicateTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            return duplicateTemplate(id);
        },
        onSuccess: () => {
            // Invalidate and refetch templates list
            queryClient.invalidateQueries({ queryKey: templateKeys.lists() });
            toast.success('Template duplicated');
        },
        onError: (error) => {
            console.error('Error duplicating template:', error);
            toast.error('Failed to duplicate template');
        },
    });
}
