/**
 * Templates Module
 * 
 * Re-exports all template-related types and functions.
 * This provides a single import point for template operations.
 * 
 * @example
 * import { saveTemplate, TemplateFilters } from '@/lib/db/templates';
 */

// Export all types
export * from './types';

// Re-export from main templates file for backwards compatibility
export {
    // CRUD Operations
    saveTemplate,
    getTemplates,
    getTemplate,
    deleteTemplate,
    duplicateTemplate,
    // Filter Operations
    getTemplatesFiltered,
    getTemplatesWithElements,

    // Metadata Operations
    updateTemplateMetadata,
    checkTemplateNameExists,
} from '../templates';

// Export cached functions (Server Only)
export { getPublicTemplates } from '../templates-cached';

