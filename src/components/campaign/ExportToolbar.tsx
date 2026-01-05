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

    // Copy All URLs
    const handleCopyUrls = async () => {
        if (completedPins.length === 0 && !isEntireCampaignSelected) {
            toast.error('No URLs to copy');
            return;
        }

        let urlsToCopy = '';

        if (isEntireCampaignSelected && totalCount && totalCount > pins.length) {
            // Fetch all URLs from DB
            const fetchPromise = new Promise<{ data: any[] }>(async (resolve, reject) => {
                try {
                    const { data: { session } } = await supabase.auth.getSession();
                    const token = session?.access_token;
                    
                    if (!token) {
                         reject(new Error('Authentication required'));
                         return;
                    }

                    const response = await fetch(`/api/generated-pins?campaign_id=${window.location.pathname.split('/')[3]}&fields=image_url&limit=10000`, {
                         headers: {
                             'Authorization': `Bearer ${token}`
                         }
                    });

                    if (!response.ok) {
                        reject(new Error(`HTTP error ${response.status}`));
                        return;
                    }
                    const result = await response.json();
                    if (!result.success || !result.data) {
                        reject(new Error('API returned error'));
                        return;
                    }
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            });

            toast.promise(fetchPromise, {
                loading: 'Fetching all URLs...',
                success: 'URLs fetched successfully',
                error: (err) => `Failed: ${err.message}`
            });

            try {
                const result = await fetchPromise;
                urlsToCopy = result.data.map((p: any) => p.image_url).filter(Boolean).join('\n');
            } catch (error) {
                console.error('Fetch failed:', error);
                return;
            }
        } else {
            urlsToCopy = completedPins.map((p) => p.imageUrl).join('\n');
        }

        if (!urlsToCopy) {
            toast.error('No URLs found to copy');
            return;
        }

        try {
            await navigator.clipboard.writeText(urlsToCopy);
            setIsCopied(true);
            toast.success(`${isEntireCampaignSelected ? 'All' : completedPins.length} URLs copied to clipboard`);
            setTimeout(() => setIsCopied(false), 2000);
        } catch {
            toast.error('Failed to copy to clipboard');
        }
    };

    // Export as CSV
    const handleExportCsv = async () => {
        if (!csvData || csvData.length === 0) {
            toast.error('No CSV data available');
            return;
        }

        // Get headers from first row
        const headers = Object.keys(csvData[0]);
        headers.push('generated_image_url');

        let rowsData: string[] = [];

        if (isEntireCampaignSelected && totalCount && totalCount > pins.length) {
            // Fetch all data for CSV
            const fetchPromise = new Promise<{ data: any[] }>(async (resolve, reject) => {
                try {
                    const { data: { session } } = await supabase.auth.getSession();
                    const token = session?.access_token;
                    
                    if (!token) {
                         reject(new Error('Authentication required'));
                         return;
                    }

                    const response = await fetch(`/api/generated-pins?campaign_id=${window.location.pathname.split('/')[3]}&fields=image_url,data_row&limit=10000`, {
                         headers: {
                             'Authorization': `Bearer ${token}`
                         }
                    });
                    if (!response.ok) {
                        reject(new Error(`HTTP error ${response.status}`));
                        return;
                    }
                    const result = await response.json();
                    if (!result.success || !result.data) {
                        reject(new Error('API returned error'));
                        return;
                    }
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            });

            toast.promise(fetchPromise, {
                loading: 'Fetching all data for CSV...',
                success: 'Data prepared',
                error: (err) => `Failed: ${err.message}`
            });

             try {
                const result = await fetchPromise;
                // Create a map of rowIndex -> imageUrl
                const urlMap = new Map<number, string>();
                result.data.forEach((p: any, index: number) => {
                        const rIndex = p.data_row?.rowIndex ?? index; // Fallback
                        if (p.image_url) urlMap.set(rIndex, p.image_url);
                });

                rowsData = csvData.map((row, index) => {
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
             } catch (error) {
                 console.error('CSV export failed:', error);
                 return;
             }
        } else {
            // Standard client-side export
            rowsData = csvData.map((row, index) => {
                const pin = pins.find((p) => p.rowIndex === index);
                const imageUrl = pin?.imageUrl || '';
                const values = headers.map((h) => {
                    const value = h === 'generated_image_url' ? imageUrl : row[h] || '';
                    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                        return `"${value.replace(/"/g, '""')}"`;
                    }
                    return value;
                });
                return values.join(',');
            });
        }

        const csvContent = [headers.join(','), ...rowsData].join('\n');

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${campaignName.replace(/[^a-z0-9]/gi, '-')}-with-urls.csv`;
        link.click();
        URL.revokeObjectURL(url);

        toast.success('CSV exported with image URLs');
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
