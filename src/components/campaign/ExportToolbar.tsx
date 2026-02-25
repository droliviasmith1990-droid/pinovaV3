'use client';

import React, { useState } from 'react';
import { Download, Copy, FileSpreadsheet, Loader2, Check } from 'lucide-react';
import JSZip from 'jszip';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { PinCardData } from './PinCard';

interface ExportToolbarProps {
    pins: PinCardData[];
    campaignName: string;
    csvData?: Record<string, string>[];
    totalCount?: number;
    isEntireCampaignSelected?: boolean;
    minimal?: boolean;
}

export function ExportToolbar({ pins, campaignName, csvData, totalCount, isEntireCampaignSelected, minimal = false }: ExportToolbarProps) {
    const [isZipping, setIsZipping] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    const [zipProgress, setZipProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

    const completedPins = pins.filter((p) => p.status === 'completed' && p.imageUrl);

    // ... (logic remains same) ...

    // Use a fragment or simple div if minimal, else the styled card
    const Container = minimal ? 'div' : 'div';
    const containerClass = minimal 
        ? "flex items-center gap-2" 
        : "flex items-center gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200";

    // Download All as ZIP
    const handleDownloadZip = async () => {
        // ... (logic remains same) ...
        if (completedPins.length === 0 && !isEntireCampaignSelected) {
            toast.error('No pins to download');
            return;
        }

        if (isEntireCampaignSelected) {
            toast.info('Downloading all pins from database is limited to 50 items at a time currently to prevent browser crashes. Please download by page.', { duration: 5000 });
            return;
        }

        setIsZipping(true);
        setZipProgress({ current: 0, total: completedPins.length });

        try {
            const zip = new JSZip();

            for (let i = 0; i < completedPins.length; i++) {
                const pin = completedPins[i];
                setZipProgress({ current: i + 1, total: completedPins.length });

                try {
                    const response = await fetch(pin.imageUrl);
                    const blob = await response.blob();
                    zip.file(`pin-${pin.rowIndex + 1}.png`, blob);
                } catch (error) {
                    console.warn(`Failed to fetch pin ${pin.rowIndex + 1}:`, error);
                }
            }

            const content = await zip.generateAsync({ type: 'blob' });
            const date = new Date().toISOString().split('T')[0];
            const fileName = `${campaignName.replace(/[^a-z0-9]/gi, '-')}-${date}.zip`;

            // Trigger download
            const url = URL.createObjectURL(content);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.click();
            URL.revokeObjectURL(url);

            toast.success(`Downloaded ${completedPins.length} pins as ZIP`);
        } catch (error) {
            console.error('Error creating ZIP:', error);
            toast.error('Failed to create ZIP file');
        } finally {
            setIsZipping(false);
        }
    };

    // Helper: fetch all pins from the API (not just current page)
    const fetchAllPins = async (fields: string = 'image_url'): Promise<Record<string, unknown>[]> => {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        
        if (!token) throw new Error('Authentication required');

        const campaignId = window.location.pathname.split('/')[3];
        const response = await fetch(`/api/generated-pins?campaign_id=${campaignId}&fields=${fields}&limit=10000`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const result = await response.json();
        if (!result.success || !result.data) throw new Error('API returned error');
        return result.data;
    };

    // Copy All URLs — always fetches ALL pins from the API
    const handleCopyUrls = async () => {
        if (completedPins.length === 0 && (!totalCount || totalCount === 0)) {
            toast.error('No URLs to copy');
            return;
        }

        const loadingToast = toast.loading('Fetching all URLs...');

        try {
            const allPins = await fetchAllPins('image_url');
            const urlsToCopy = allPins
                .map((p) => p.image_url as string)
                .filter(Boolean)
                .join('\n');

            if (!urlsToCopy) {
                toast.dismiss(loadingToast);
                toast.error('No URLs found');
                return;
            }

            toast.dismiss(loadingToast);

            // Try clipboard write (works on HTTPS, and some HTTP browsers)
            let copied = false;
            try {
                await navigator.clipboard.writeText(urlsToCopy);
                copied = true;
            } catch {
                // Fallback: textarea + execCommand
                const textarea = document.createElement('textarea');
                textarea.value = urlsToCopy;
                textarea.style.position = 'fixed';
                textarea.style.left = '0';
                textarea.style.top = '0';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                try {
                    copied = document.execCommand('copy');
                } catch { /* ignore */ }
                document.body.removeChild(textarea);
            }

            if (copied) {
                setIsCopied(true);
                toast.success(`${allPins.length} URLs copied to clipboard`);
                setTimeout(() => setIsCopied(false), 2000);
            } else {
                // Last resort: open in new window for manual copy
                const w = window.open('', '_blank', 'width=600,height=400');
                if (w) {
                    w.document.write(`<pre style="word-wrap:break-word;white-space:pre-wrap">${urlsToCopy}</pre>`);
                    w.document.title = 'Copy URLs';
                }
                toast.info('URLs opened in new window — please copy manually (Ctrl+A, Ctrl+C)');
            }
        } catch (error) {
            toast.dismiss(loadingToast);
            console.error('Copy URLs failed:', error);
            toast.error('Failed to fetch URLs');
        }
    };

    // Export as CSV — always fetches ALL pins to include generated_image_url
    const handleExportCsv = async () => {
        if (!csvData || csvData.length === 0) {
            toast.error('No CSV data available');
            return;
        }

        // Get headers from first row
        const headers = Object.keys(csvData[0]);
        headers.push('generated_image_url');

        const loadingToast = toast.loading('Preparing CSV with all URLs...');

        try {
            const allPins = await fetchAllPins('image_url,data_row');

            // Create a map of rowIndex -> imageUrl
            const urlMap = new Map<number, string>();
            allPins.forEach((p, index) => {
                const dataRow = p.data_row as Record<string, unknown> | undefined;
                const rIndex = typeof dataRow?.rowIndex === 'number' ? dataRow.rowIndex : index;
                if (p.image_url) urlMap.set(rIndex, p.image_url as string);
            });

            console.log(`[CSV Export] Mapped ${urlMap.size} URLs from ${allPins.length} pins. CSV rows: ${csvData.length}`);

            const rowsData = csvData.map((row, index) => {
                const imageUrl = urlMap.get(index) || '';
                const values = headers.map((h) => {
                    const value = h === 'generated_image_url' ? imageUrl : row[h] || '';
                    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                        return `"${value.replace(/"/g, '""')}"`;
                    }
                    return value;
                });
                return values.join(',');
            });

            const csvContent = [headers.join(','), ...rowsData].join('\n');

            // Download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${campaignName.replace(/[^a-z0-9]/gi, '-')}-with-urls.csv`;
            link.click();
            URL.revokeObjectURL(url);

            toast.dismiss(loadingToast);
            toast.success(`CSV exported with ${urlMap.size} image URLs`);
        } catch (error) {
            toast.dismiss(loadingToast);
            console.error('CSV export failed:', error);
            toast.error('Failed to export CSV');
        }
    };

    return (
        <Container className={containerClass}>
            {/* Download ZIP */}
            <button
                onClick={handleDownloadZip}
                disabled={isZipping || completedPins.length === 0}
                className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-xs transition-all",
                    "bg-orange-600 text-white hover:bg-orange-700",
                    (isZipping || completedPins.length === 0) && "opacity-50 cursor-not-allowed"
                )}
            >
                {isZipping ? (
                    <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Zipping...
                    </>
                ) : (
                    <>
                        <Download className="w-3.5 h-3.5" />
                        Download ZIP
                    </>
                )}
            </button>

            {/* Copy All URLs */}
            <button
                onClick={handleCopyUrls}
                disabled={completedPins.length === 0}
                className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-xs transition-all",
                    "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50",
                    completedPins.length === 0 && "opacity-50 cursor-not-allowed"
                )}
            >
                {isCopied ? (
                    <>
                        <Check className="w-3.5 h-3.5 text-green-600" />
                        Copied
                    </>
                ) : (
                    <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy URLs
                    </>
                )}
            </button>

            {/* Export CSV */}
            <button
                onClick={handleExportCsv}
                disabled={!csvData}
                className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg font-medium text-xs transition-all",
                    "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50",
                    !csvData && "opacity-50 cursor-not-allowed"
                )}
            >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                CSV
            </button>
        </Container>
    );
}
