// Campaign database operations
import { supabase, isSupabaseConfigured, getCurrentUserId } from '../supabase';
import { 
    DbCampaign, 
    CampaignStatus, 
    FieldMapping, 
    DistributionMode, 
    TemplateSnapshot,
    CampaignStatistics 
} from '@/types/database.types';

// ============================================
// Types for campaign operations
// ============================================
export interface CreateCampaignData {
    template_id?: string; // Optional for backward compat
    template_ids?: string[]; // NEW: Array of template IDs
    distribution_mode?: DistributionMode; // NEW
    template_snapshot?: TemplateSnapshot[]; // NEW
    name: string;
    csv_data: Record<string, unknown>[];
    csv_url?: string; // NEW: URL to CSV in storage
    field_mapping: FieldMapping;
    total_pins: number;
    pinterest_board_id?: string;
    auto_post?: boolean;
    schedule_time?: string;
}

export interface CampaignListItem {
    id: string;
    name: string;
    template_id: string;
    template_ids: string[] | null; // NEW
    distribution_mode: DistributionMode; // NEW
    total_pins: number;
    generated_pins: number;
    status: CampaignStatus;
    created_at: string;
    updated_at: string;
}

// Extended campaign type with additional fields from migrations
export interface CampaignWithDetails extends DbCampaign {
    current_index?: number;
    paused_at?: string;
    generation_settings?: Record<string, unknown>;
}

// ============================================
// Campaign CRUD Operations
// ============================================

/**
 * Create a new campaign
 * @param data Campaign data
 * @returns The created campaign or null on error
 */
export async function createCampaign(data: CreateCampaignData): Promise<DbCampaign | null> {
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
        // Determine template_id for backward compatibility
        const primaryTemplateId = data.template_id || (data.template_ids?.[0] ?? '');
        
        const insertData = {
            user_id: userId,
            template_id: primaryTemplateId, // Keep for backward compat
            template_ids: data.template_ids || (data.template_id ? [data.template_id] : null),
            distribution_mode: data.distribution_mode || 'sequential',
            template_snapshot: data.template_snapshot || null,
            name: data.name,
            csv_data: data.csv_url ? [] : data.csv_data, // Don't store data if we have URL
            csv_url: data.csv_url || null,
            field_mapping: data.field_mapping,
            total_pins: data.total_pins,
            pinterest_board_id: data.pinterest_board_id || null,
            auto_post: data.auto_post ?? false,
            schedule_time: data.schedule_time || null,
        };

        const { data: campaign, error } = await supabase
            .from('campaigns')
            .insert(insertData)
            .select()
            .single();

        if (error) {
            console.error('Error creating campaign:', error);
            return null;
        }

        return campaign;
    } catch (error) {
        console.error('Error creating campaign:', error);
        return null;
    }
}

/**
 * Get all campaigns for the current user
 * @returns Array of campaigns or empty array on error
 */
export async function getCampaigns(): Promise<CampaignListItem[]> {
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
        // First get campaigns
        const { data: campaigns, error } = await supabase
            .from('campaigns')
            .select('id, name, template_id, template_ids, distribution_mode, total_pins, generated_pins, status, created_at, updated_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching campaigns:', error);
            return [];
        }

        return campaigns || [];
    } catch (error) {
        console.error('Error fetching campaigns:', error);
        return [];
    }
}

/**
 * Get a single campaign with full data
 * @param campaignId Campaign ID
 * @returns Full campaign data or null
 */
export async function getCampaign(campaignId: string): Promise<CampaignWithDetails | null> {
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
        const { data: campaign, error } = await supabase
            .from('campaigns')
            .select('*')
            .eq('id', campaignId)
            .eq('user_id', userId)
            .single();

        if (error) {
            console.error('Error fetching campaign:', error);
            return null;
        }

        return campaign;
    } catch (error) {
        console.error('Error fetching campaign:', error);
        return null;
    }
}

/**
 * Update campaign progress
 * @param campaignId Campaign ID
 * @param generatedPins Number of generated pins
 * @param status Optional new status
 * @returns true on success, false on error
 */
export async function updateCampaignProgress(
    campaignId: string,
    generatedPins: number,
    status?: CampaignStatus
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
        const updateData: Record<string, unknown> = {
            generated_pins: generatedPins,
        };

        if (status) {
            updateData.status = status;
            if (status === 'completed') {
                updateData.completed_at = new Date().toISOString();
            }
        }

        const { error } = await supabase
            .from('campaigns')
            .update(updateData)
            .eq('id', campaignId)
            .eq('user_id', userId);

        if (error) {
            console.error('Error updating campaign progress:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error updating campaign progress:', error);
        return false;
    }
}

/**
 * Delete a campaign
 * @param campaignId Campaign ID to delete
 * @returns true on success, false on error
 */
export async function deleteCampaign(campaignId: string): Promise<boolean> {
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
            .from('campaigns')
            .delete()
            .eq('id', campaignId)
            .eq('user_id', userId);

        if (error) {
            console.error('Error deleting campaign:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error deleting campaign:', error);
        return false;
    }
}

/**
 * Delete multiple campaigns
 * @param campaignIds Array of Campaign IDs to delete
 * @returns true on success, false on error
 */
export async function deleteCampaigns(campaignIds: string[]): Promise<boolean> {
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
            .from('campaigns')
            .delete()
            .in('id', campaignIds)
            .eq('user_id', userId);

        if (error) {
            console.error('Error deleting campaigns:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error deleting campaigns:', error);
        return false;
    }
}

/**
 * Update a campaign with arbitrary fields
 * @param campaignId Campaign ID
 * @param updates Fields to update
 * @returns true on success, false on error
 */
export async function updateCampaign(
    campaignId: string,
    updates: Record<string, unknown>
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
        const { error } = await supabase
            .from('campaigns')
            .update({
                ...updates,
                updated_at: new Date().toISOString(),
            })
            .eq('id', campaignId)
            .eq('user_id', userId);

        if (error) {
            console.error('Error updating campaign:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error updating campaign:', error);
        return false;
    }
}

/**
 * Pause a campaign
 * @param campaignId Campaign ID to pause
 * @returns true on success, false on error
 */
export async function pauseCampaign(campaignId: string): Promise<boolean> {
    return updateCampaign(campaignId, {
        status: 'paused',
        paused_at: new Date().toISOString(),
    });
}

/**
 * Resume a paused campaign
 * @param campaignId Campaign ID to resume
 * @returns true on success, false on error
 */
export async function resumeCampaign(campaignId: string): Promise<boolean> {
    return updateCampaign(campaignId, {
        status: 'processing',
        paused_at: null,
    });
}

/**
 * Bulk update campaign statuses
 * @param campaignIds Array of campaign IDs
 * @param status New status to set
 * @returns true on success, false on error
 */
export async function updateCampaignsStatus(
    campaignIds: string[],
    status: CampaignStatus
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
        const updateData: Record<string, unknown> = {
            status,
            updated_at: new Date().toISOString(),
        };

        if (status === 'paused') {
            updateData.paused_at = new Date().toISOString();
        } else {
            updateData.paused_at = null;
        }

        const { error } = await supabase
            .from('campaigns')
            .update(updateData)
            .in('id', campaignIds)
            .eq('user_id', userId);

        if (error) {
            console.error('Error bulk updating campaign status:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error bulk updating campaign status:', error);
        return false;
    }
}

