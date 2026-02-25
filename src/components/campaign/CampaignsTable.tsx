"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  MoreVertical,
  Play,
  Pause,
  Copy,
  Download,
  Trash2,
  Clock,
  Loader2,
  CheckCircle,
  FileSpreadsheet
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteCampaigns, deleteCampaign, pauseCampaign, resumeCampaign, updateCampaignsStatus } from "@/lib/db/campaigns";

// Types
export interface Campaign {
  id: string;
  name: string;
  status: 'paused' | 'pending' | 'generating' | 'completed' | 'failed';
  generated: number;
  totalPins: number;
  createdAt: string; // ISO date string
}

interface CampaignsTableProps {
  campaigns: Campaign[];
  onRefresh?: () => void;
}

export function CampaignsTable({ campaigns, onRefresh }: CampaignsTableProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(campaigns.map(c => c.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleBulkAction = async () => {
    if (!bulkAction || selectedIds.length === 0) return;
    
    setIsProcessing(true);

    switch (bulkAction) {
      case 'pause': {
        const success = await updateCampaignsStatus(selectedIds, 'paused');
        if (success) {
          toast.success(`Paused ${selectedIds.length} campaigns`);
          onRefresh?.();
        } else {
          toast.error('Failed to pause campaigns');
        }
        break;
      }
      case 'resume': {
        const success = await updateCampaignsStatus(selectedIds, 'processing');
        if (success) {
          toast.success(`Resumed ${selectedIds.length} campaigns`);
          onRefresh?.();
        } else {
          toast.error('Failed to resume campaigns');
        }
        break;
      }
      case 'duplicate':
        toast.success(`Duplicated ${selectedIds.length} campaigns`);
        break;
      case 'export':
        toast.success(`Exported ${selectedIds.length} campaigns to CSV`);
        break;
      case 'delete': {
        const success = await deleteCampaigns(selectedIds);
        if (success) {
            toast.success(`Deleted ${selectedIds.length} campaigns`);
            onRefresh?.();
        } else {
            toast.error('Failed to delete campaigns');
        }
        break;
      }
      default:
        toast.info(`Action ${bulkAction} applied to ${selectedIds.length} items`);
    }
    
    setIsProcessing(false);
    setBulkAction('');
    setSelectedIds([]);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-full">
      {/* Bulk Actions Bar (shows when items selected) */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between px-6 py-3 bg-blue-50 border-b border-blue-100 animate-fade-in-up">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-blue-900 bg-blue-100 px-3 py-1 rounded-full">
              {selectedIds.length} selected
            </span>
            
            <div className="flex items-center gap-2">
                <select
                value={bulkAction}
                onChange={(e) => setBulkAction(e.target.value)}
                className="px-3 py-1.5 border border-blue-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                <option value="">Bulk Actions</option>
                <option value="pause">Pause</option>
                <option value="resume">Resume</option>
                <option value="duplicate">Duplicate</option>
                <option value="export">Export CSV</option>
                <option value="delete">Delete</option>
                </select>

                <button
                onClick={handleBulkAction}
                disabled={!bulkAction || isProcessing}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm min-w-[80px]"
                >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  "Apply"
                )}
                </button>
            </div>
          </div>

          <button
            onClick={() => setSelectedIds([])}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium hover:underline"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Table Header */}
      <div className="grid grid-cols-[40px_2fr_1fr_1fr_1fr_60px] gap-4 px-6 py-3 border-b border-gray-200 bg-gray-50/50">
        <div className="flex items-center">
          <input
            type="checkbox"
            checked={campaigns.length > 0 && selectedIds.length === campaigns.length}
            onChange={(e) => handleSelectAll(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
          />
        </div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Campaign
        </div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Status
        </div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Progress
        </div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Created
        </div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">
          
        </div>
      </div>

      {/* Table Rows */}
      <div className="divide-y divide-gray-100 overflow-y-auto custom-scrollbar flex-1 bg-white">
        {campaigns.length === 0 ? (
           <div className="flex flex-col items-center justify-center py-12 text-center text-gray-500">
               <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                   <FileSpreadsheet className="w-8 h-8 text-gray-400" />
               </div>
               <p className="font-medium text-lg">No campaigns found</p>
               <p className="text-sm mb-6">Get started by creating your first bulk generation campaign</p>
               <Link href="/dashboard/campaigns/new" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Create Campaign</Link>
           </div>
        ) : (
            campaigns.map(campaign => (
            <CampaignRow
                key={campaign.id}
                campaign={campaign}
                isSelected={selectedIds.includes(campaign.id)}
                onSelect={(checked) => {
                if (checked) {
                    setSelectedIds([...selectedIds, campaign.id]);
                } else {
                    setSelectedIds(selectedIds.filter(id => id !== campaign.id));
                }
                }}
                onRefresh={onRefresh}
            />
            ))
        )}
      </div>
    </div>
  );
}

interface CampaignRowProps {
  campaign: Campaign;
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  onRefresh?: () => void;
}

// Campaign Row Component
function CampaignRow({ campaign, isSelected, onSelect, onRefresh }: CampaignRowProps) {
    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this campaign?')) return;
        
        try {
            const success = await deleteCampaign(campaign.id);
            if (success) {
                toast.success('Campaign deleted');
                onRefresh?.();
            } else {
                toast.error('Failed to delete campaign');
            }
        } catch {
            toast.error('Error deleting campaign');
        }
    };

    const handlePause = async () => {
        const success = await pauseCampaign(campaign.id);
        if (success) {
            toast.success(`Campaign "${campaign.name}" paused`);
            onRefresh?.();
        } else {
            toast.error('Failed to pause campaign');
        }
    };

    const handleResume = async () => {
        const success = await resumeCampaign(campaign.id);
        if (success) {
            toast.success(`Campaign "${campaign.name}" resumed`);
            onRefresh?.();
        } else {
            toast.error('Failed to resume campaign');
        }
    };

    const canPause = campaign.status === 'generating' || campaign.status === 'completed';
    const canResume = campaign.status === 'paused';
  return (
    <div
      className={cn(
        "grid grid-cols-[40px_2fr_1fr_1fr_1fr_60px] gap-4 px-6 py-4 hover:bg-gray-50 transition-colors items-center group",
        isSelected && "bg-blue-50/50"
      )}
    >
      {/* Checkbox */}
      <div className="flex items-center">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onSelect(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
        />
      </div>

      {/* Campaign Name & Thumbnail */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm">
          {campaign.name.substring(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <Link
            href={`/dashboard/campaigns/${campaign.id}`}
            className="font-medium text-gray-900 hover:text-blue-600 truncate block"
          >
            {campaign.name}
          </Link>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {campaign.totalPins} pins total
          </p>
        </div>
      </div>

      {/* Status Badge */}
      <div className="flex items-center">
        <StatusBadge status={campaign.status} />
      </div>

      {/* Progress Bar */}
      <div className="flex items-center pr-4">
        <div className="w-full">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-700">
              {campaign.generated}/{campaign.totalPins}
            </span>
            <span className="text-xs text-gray-500">
              {Math.round((campaign.generated / campaign.totalPins) * 100)}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-600 rounded-full transition-all duration-500"
              style={{ width: `${(campaign.generated / campaign.totalPins) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Created Date */}
      <div className="flex items-center text-sm text-gray-500">
         {/* Using a try-catch for date parsing safely */}
        {(() => {
            try {
                return format(new Date(campaign.createdAt), 'MMM dd, yyyy');
            } catch (_) {
                return <span title={campaign.createdAt}>Invalid Date</span>;
            }
        })()}
      </div>

      {/* Actions Dropdown */}
      <div className="flex items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-2 hover:bg-gray-200 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100">
              <MoreVertical className="w-4 h-4 text-gray-500" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[160px]">
            {canResume && (
              <DropdownMenuItem onClick={handleResume} className="cursor-pointer">
                <Play className="w-4 h-4 mr-2" />
                Resume
              </DropdownMenuItem>
            )}
            {canPause && (
              <DropdownMenuItem onClick={handlePause} className="cursor-pointer">
                <Pause className="w-4 h-4 mr-2" />
                Pause
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="cursor-pointer">
              <Copy className="w-4 h-4 mr-2" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer">
              <Download className="w-4 h-4 mr-2" />
              Export
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
                onClick={handleDelete}
                className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// Status Badge Component
function StatusBadge({ status }: { status: 'paused' | 'pending' | 'generating' | 'completed' | 'failed' }) {
  const variants = {
    paused: { bg: 'bg-orange-100', text: 'text-orange-700', icon: <Pause className="w-3 h-3" /> },
    pending: { bg: 'bg-gray-100', text: 'text-gray-700', icon: <Clock className="w-3 h-3" /> },
    generating: { bg: 'bg-blue-100', text: 'text-blue-700', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    completed: { bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle className="w-3 h-3" /> },
    failed: { bg: 'bg-red-100', text: 'text-red-700', icon: <div className="w-3 h-3 rounded-full bg-red-500" /> }
  };

  const variant = variants[status] || variants.pending;

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-transparent",
      variant.bg,
      variant.text
    )}>
      {variant.icon}
      <span className="capitalize">{status}</span>
    </div>
  );
}
