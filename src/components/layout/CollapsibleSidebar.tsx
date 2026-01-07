"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LayoutDashboard,
  FileStack,
  Megaphone,
  FolderOpen,
  Tag,
  Type,
  LogOut,
  Plus,
  Zap,
  Home,
  PinIcon,
  Key
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarState {
  isCollapsed: boolean;
  activeSection: string | null;
}

interface NavItem {
  icon: React.ReactNode;
  label: string;
  href: string;
  badge?: string;
  count?: number;
  active?: boolean;
}

interface NavSectionProps {
  title?: string;
  icon?: React.ReactNode;
  isCollapsed: boolean;
  items: NavItem[];
  defaultOpen?: boolean;
}

export function CollapsibleSidebar() {
  const [isCollapsed, setIsCollapsed] = useState(true);
  
  return (
    <aside 
      className={cn(
        "bg-white border-r border-gray-200 transition-all duration-300 flex flex-col h-screen sticky top-0 shrink-0",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header with collapse toggle */}
      <div className="flex items-center justify-between p-4 border-b shrink-0">
        {!isCollapsed && (
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center shrink-0">
              <PinIcon className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-sm truncate">Pin Generator</h1>
              <p className="text-xs text-gray-500 truncate">Bulk creation tool</p>
            </div>
          </div>
        )}
        
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1.5 hover:bg-gray-100 rounded-lg ml-auto"
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Quick Actions - Always visible */}
        <div className="p-3 space-y-2 border-b">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link 
                  href="/editor"
                  className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg",
                  "bg-gradient-to-r from-blue-500 to-blue-600 text-white",
                  "hover:from-blue-600 hover:to-blue-700 transition-all",
                  isCollapsed && "justify-center px-0"
                )}>
                  <Plus className="w-5 h-5 shrink-0" />
                  {!isCollapsed && <span className="font-medium whitespace-nowrap">New Template</span>}
                </Link>
              </TooltipTrigger>
              {isCollapsed && <TooltipContent side="right">New Template</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
          
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link 
                  href="/dashboard/campaigns/new"
                  className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg",
                  "bg-gradient-to-r from-pink-500 to-purple-600 text-white",
                  "hover:from-pink-600 hover:to-purple-700 transition-all",
                  isCollapsed && "justify-center px-0"
                )}>
                  <Zap className="w-5 h-5 shrink-0" />
                  {!isCollapsed && <span className="font-medium whitespace-nowrap">Bulk Generate</span>}
                </Link>
              </TooltipTrigger>
              {isCollapsed && <TooltipContent side="right">Bulk Generate</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-6">
          {/* Overview Section */}
          <NavSection
            title="OVERVIEW"
            icon={<Home className="w-5 h-5" />}
            isCollapsed={isCollapsed}
            items={[
              { icon: <LayoutDashboard className="w-5 h-5" />, label: "Dashboard", href: "/dashboard" }
            ]}
          />

          {/* Library Section */}
          <NavSection
            title="LIBRARY"
            isCollapsed={isCollapsed}
            items={[
              { icon: <FileStack className="w-5 h-5" />, label: "My Templates", href: "/dashboard/templates" },
              { icon: <Megaphone className="w-5 h-5" />, label: "Campaigns", href: "/dashboard/campaigns" },
              { icon: <Key className="w-5 h-5" />, label: "API Keys", href: "/dashboard/api-keys" },
              { icon: <Type className="w-5 h-5" />, label: "Fonts", href: "/dashboard/fonts" },
              { icon: <FolderOpen className="w-5 h-5" />, label: "Categories", href: "/dashboard/categories" },
              { icon: <Tag className="w-5 h-5" />, label: "Tags", href: "/dashboard/tags" }
            ]}
          />
        </nav>
      </div>

      {/* Footer - User section */}
      <div className="p-3 border-t bg-gray-50 mt-auto shrink-0">
         <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors",
                  isCollapsed && "justify-center px-0"
                )}>
                  <LogOut className="w-4 h-4 text-gray-600 shrink-0" />
                  {!isCollapsed && <span className="text-sm text-gray-700 whitespace-nowrap">Sign out</span>}
                </button>
              </TooltipTrigger>
              {isCollapsed && <TooltipContent side="right">Sign out</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
      </div>
    </aside>
  );
}

// NavSection Component
function NavSection({ title, icon, isCollapsed, items, defaultOpen = true }: NavSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (isCollapsed) {
    // Show only icons with tooltips
    return (
      <div className="space-y-1">
        {items.map(item => (
           <TooltipProvider key={item.label} delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  className={cn(
                    "w-full flex items-center justify-center p-2.5 rounded-lg",
                    "hover:bg-gray-100 transition-colors relative",
                    item.active && "bg-blue-50 text-blue-600"
                  )}
                >
                  {item.icon}
                  {item.badge && (
                    <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
                  )}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                {item.label}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </div>
    );
  }

  return (
    <div>
      {title && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-between w-full px-2 py-1 mb-2 group"
        >
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider group-hover:text-gray-700">
            {title}
          </span>
          <ChevronDown className={cn(
            "w-3 h-3 text-gray-400 transition-transform",
            !isOpen && "-rotate-90"
          )} />
        </button>
      )}

      {isOpen && (
        <div className="space-y-1">
          {items.map(item => (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg",
                "hover:bg-gray-100 transition-colors group",
                item.active && "bg-blue-50 text-blue-600 font-medium"
              )}
            >
              <span className={cn(
                "text-gray-400 group-hover:text-gray-600",
                item.active && "text-blue-600"
              )}>
                {item.icon}
              </span>
              <span className="flex-1 text-sm truncate">{item.label}</span>
              
              {item.badge && (
                <span className="px-2 py-0.5 text-xs bg-red-500 text-white rounded-full">
                  {item.badge}
                </span>
              )}
              {item.count && (
                <span className="text-xs text-gray-400">{item.count}</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
