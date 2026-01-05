'use client';

import React from 'react';
import Image from 'next/image';
import { FileSpreadsheet, Calendar, Monitor, Server, CheckCircle, Clock, Loader2, XCircle, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CampaignDashboardCardProps {
    // Summary
    campaignName: string;
    templateName?: string;
    templateThumbnail?: string;
    canvasSize?: { width: number; height: number };
    csvRowCount: number;
    createdAt: string;
    
    // Render Mode
    renderMode: 'client' | 'server';
    onRenderModeChange: (mode: 'client' | 'server') => void;
    disabled?: boolean;
    
    // Generation Progress
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'paused';
    progress: {
        current: number;
        total: number;
        percentage: number;
    };
    completedAt?: string;
    speed?: number;
}

export function CampaignDashboardCard({
    campaignName,
    templateName,
    templateThumbnail,
    canvasSize,
    csvRowCount,
    createdAt,
    renderMode,
    onRenderModeChange,
    disabled = false,
    status,
    progress,
    completedAt,
    speed,
}: CampaignDashboardCardProps) {
    
    // Format datetime
    const formatDateTime = (dateString: string) => {
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            });
        } catch {
            return dateString;
        }
    };

    // Status display config
    const getStatusInfo = () => {
        switch (status) {
            case 'completed':
                return { icon: CheckCircle, color: 'text-green-600', barColor: 'bg-green-500' };
            case 'processing':
                return { icon: Loader2, color: 'text-blue-600', barColor: 'bg-blue-500', animate: true };
            case 'paused':
                return { icon: Pause, color: 'text-amber-600', barColor: 'bg-amber-500' };
            case 'failed':
                return { icon: XCircle, color: 'text-red-600', barColor: 'bg-red-500' };
            default:
                return { icon: Clock, color: 'text-gray-500', barColor: 'bg-gray-400' };
        }
    };

    const statusInfo = getStatusInfo();

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-100">
                
                {/* Column 1: Campaign Summary */}
                <div className="p-5">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Campaign Summary</h3>
                    
                    <div className="flex gap-3">
                        {/* Template Thumbnail */}
                        {templateThumbnail && (
                            <div className="shrink-0">
                                <div className="w-16 h-20 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                                    <Image
                                        src={templateThumbnail}
                                        alt={templateName || 'Template'}
                                        width={64}
                                        height={80}
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                            </div>
                        )}
                        
                        <div className="flex-1 min-w-0 space-y-2">
                            {/* Name + Status */}
                            <div className="flex items-center gap-2">
                                <p className="text-sm font-bold text-gray-900 truncate" title={campaignName}>
                                    {campaignName || 'Untitled'}
                                </p>
                                <span className={cn(
                                    "text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0",
                                    status === 'completed' && "bg-green-100 text-green-700",
                                    status === 'processing' && "bg-blue-100 text-blue-700",
                                    status === 'paused' && "bg-amber-100 text-amber-700",
                                    status === 'failed' && "bg-red-100 text-red-700",
                                    status === 'pending' && "bg-gray-100 text-gray-600"
                                )}>
                                    {status}
                                </span>
                            </div>
                            
                            {/* Template */}
                            <p className="text-xs text-gray-500 truncate" title={templateName}>
                                {templateName || 'Template'}
                                {canvasSize && (
                                    <span className="text-gray-400 ml-1">({canvasSize.width}×{canvasSize.height})</span>
                                )}
                            </p>
                            
                            {/* Data Source */}
                            <div className="flex items-center gap-1.5">
                                <FileSpreadsheet className="w-3 h-3 text-blue-500" />
                                <span className="text-xs text-gray-600">{csvRowCount.toLocaleString()} rows</span>
                            </div>
                            
                            {/* Created */}
                            <div className="flex items-center gap-1.5">
                                <Calendar className="w-3 h-3 text-gray-400" />
                                <span className="text-xs text-gray-500">{formatDateTime(createdAt)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Column 2: Render Mode (Compact) */}
                <div className="p-5">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Render Mode</h3>
                    
                    <div className="space-y-2">
                        {/* Client-Side Option */}
                        <label 
                            className={cn(
                                "flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors border",
                                renderMode === 'client' 
                                    ? "bg-blue-50 border-blue-200" 
                                    : "bg-gray-50 border-gray-100 hover:bg-gray-100",
                                disabled && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            <input
                                type="radio"
                                name="renderMode"
                                value="client"
                                checked={renderMode === 'client'}
                                onChange={() => onRenderModeChange('client')}
                                disabled={disabled}
                                className="w-3.5 h-3.5 text-blue-600"
                            />
                            <Monitor className="w-3.5 h-3.5 text-gray-500" />
                            <div className="flex-1 min-w-0">
                                <span className="text-xs font-medium text-gray-700">Client-Side</span>
                                <p className="text-[10px] text-gray-400 truncate">Browser rendering</p>
                            </div>
                        </label>

                        {/* Server-Side Option */}
                        <label 
                            className={cn(
                                "flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors border",
                                renderMode === 'server' 
                                    ? "bg-blue-50 border-blue-200" 
                                    : "bg-gray-50 border-gray-100 hover:bg-gray-100",
                                disabled && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            <input
                                type="radio"
                                name="renderMode"
                                value="server"
                                checked={renderMode === 'server'}
                                onChange={() => onRenderModeChange('server')}
                                disabled={disabled}
                                className="w-3.5 h-3.5 text-blue-600"
                            />
                            <Server className="w-3.5 h-3.5 text-gray-500" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-medium text-gray-700">Server-Side</span>
                                    <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-medium">Recommended</span>
                                </div>
                                <p className="text-[10px] text-gray-400 truncate">Faster for bulk (100+ pins)</p>
                            </div>
                        </label>
                    </div>
                </div>

                {/* Column 3: Generation Progress (Centered) */}
                <div className="p-5 flex flex-col items-center justify-center text-center">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 self-start">Generation</h3>
                    
                    <div className="w-full space-y-3">
                        {/* Progress Bar with Percentage */}
                        <div className="relative w-full h-8 bg-gray-100 rounded-full overflow-hidden">
                            <div 
                                className={cn(
                                    "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
                                    statusInfo.barColor
                                )}
                                style={{ width: `${Math.min(progress.percentage, 100)}%` }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className={cn(
                                    "text-sm font-bold",
                                    progress.percentage > 50 ? "text-white" : "text-gray-700"
                                )}>
                                    {progress.percentage.toFixed(1)}%
                                </span>
                            </div>
                        </div>

                        {/* Stats Row */}
                        <div className="flex items-center justify-center gap-2 text-xs text-gray-600">
                            <statusInfo.icon className={cn(
                                "w-4 h-4",
                                statusInfo.color,
                                statusInfo.animate && "animate-spin"
                            )} />
                            <span className="font-medium">
                                {progress.current.toLocaleString()} / {progress.total.toLocaleString()} pins
                            </span>
                            {speed !== undefined && speed > 0 && (
                                <>
                                    <span className="text-gray-300">•</span>
                                    <span className="text-gray-500">{speed.toFixed(2)} pins/sec</span>
                                </>
                            )}
                        </div>

                        {/* Completed At Timestamp */}
                        {status === 'completed' && completedAt && (
                            <p className="text-xs text-green-600 font-medium">
                                Completed at: {formatDateTime(completedAt)}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
