import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        // Beacon sends plain text or blob.
        // We use text/plain to avoid CORS preflight on unload.
        // So we must parse the text body manually.
        
        let body;
        try {
             const text = await request.text();
             body = JSON.parse(text);
        } catch {
             console.error('Beacon JSON parse failed.');
             return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
        }

        const { campaignId, status } = body;

        if (!campaignId || !status) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }
        
        // Initialize Supabase Client (Service Role to bypass RLS for system update)
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        
        const supabase = createClient(supabaseUrl, supabaseKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });

        // Update DB
        const { error } = await supabase
            .from('campaigns')
            .update({ 
                status: status,
                paused_at: status === 'paused' ? new Date().toISOString() : null,
                updated_at: new Date().toISOString() 
            })
            .eq('id', campaignId);

        if (error) {
            console.error('Beacon update failed:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (e) {
        console.error('Beacon handler error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
