-- Add index for performance optimization
-- Covers the common query pattern: WHERE user_id = ? ORDER BY updated_at DESC

CREATE INDEX IF NOT EXISTS idx_templates_user_updated 
ON public.templates(user_id, updated_at DESC);
