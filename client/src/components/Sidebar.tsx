import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { contentTypesApi, ContentType } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';
import {
  LayoutDashboard,
  FileText,
  Image,
  ChevronDown,
  LogOut,
  Database,
  Users,
  Settings,
  KeyRound,
  Zap,
  History,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChangePasswordDialog } from './ChangePasswordDialog';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const location = useLocation();
  const { logout, isAdmin, username, displayName, role } = useAuth();
  const { settings } = useSettings();
  const [contentTypes, setContentTypes] = useState<ContentType[]>([]);
  const [ctOpen, setCtOpen] = useState(true);
  const [changePwOpen, setChangePwOpen] = useState(false);

  useEffect(() => {
    contentTypesApi.list().then(setContentTypes).catch(() => {});
  }, [location.pathname]);

  const navItem = (to: string, icon: React.ReactNode, label: string) => (
    <Link
      to={to}
      onClick={() => onClose?.()}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        location.pathname === to
          ? 'bg-zinc-700 text-white'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
      )}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <aside className={cn(
      'fixed inset-y-0 left-0 z-40 w-60 bg-zinc-900 flex flex-col transition-transform duration-200 ease-in-out',
      isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
    )}>
      {/* Logo / branding */}
      <div className={cn(
        'border-b border-zinc-800',
        settings.logo_type === 'image' && settings.logo_image_url
          ? 'px-4 py-3'
          : 'flex items-center gap-2 px-4 py-5 min-h-16'
      )}>
        {settings.logo_type === 'image' && settings.logo_image_url ? (
          <img
            src={settings.logo_image_url}
            alt={settings.site_name}
            className="w-full h-auto max-h-24 object-contain object-left"
          />
        ) : (
          <>
            <Database className="h-5 w-5 text-indigo-400 shrink-0" />
            <span className="text-white font-semibold text-sm truncate">
              {settings.site_name || 'Etch CMS'}
            </span>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {navItem('/', <LayoutDashboard className="h-4 w-4" />, 'Dashboard')}

        {/* Content Types section */}
        <div className="pt-2">
          <button
            onClick={() => setCtOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-400"
          >
            <span>Content</span>
            <ChevronDown className={cn('h-3 w-3 transition-transform', ctOpen && 'rotate-180')} />
          </button>

          {ctOpen && (
            <div className="mt-1 space-y-0.5">
              {isAdmin && navItem('/content-types', <FileText className="h-4 w-4" />, 'Collections')}
              {contentTypes.map(ct => (
                <Link
                  key={ct.id}
                  to={`/content-types/${ct.id}/entries`}
                  onClick={() => onClose?.()}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors',
                    isAdmin ? 'ml-2' : '',
                    location.pathname.startsWith(`/content-types/${ct.id}`)
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 shrink-0" />
                  {ct.name}
                </Link>
              ))}
            </div>
          )}
        </div>

        {navItem('/assets', <Image className="h-4 w-4" />, 'Assets')}
        {isAdmin && navItem('/users', <Users className="h-4 w-4" />, 'Users')}
        {isAdmin && navItem('/webhooks', <Zap className="h-4 w-4" />, 'Webhooks')}
        {isAdmin && navItem('/audit-log', <History className="h-4 w-4" />, 'Activity')}
        {isAdmin && navItem('/settings', <Settings className="h-4 w-4" />, 'Settings')}
      </nav>

      {/* User info + actions */}
      <div className="p-3 border-t border-zinc-800 space-y-1">
        <div className="px-3 py-2">
          <p className="text-sm font-medium text-white truncate">{displayName}</p>
          {displayName !== username && (
            <p className="text-xs text-zinc-500 truncate">{username}</p>
          )}
          <p className="text-xs text-zinc-500 capitalize">{role}</p>
        </div>
        {role === 'editor' && (
          <button
            onClick={() => setChangePwOpen(true)}
            className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <KeyRound className="h-4 w-4" />
            Change password
          </button>
        )}
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>

      <ChangePasswordDialog open={changePwOpen} onClose={() => setChangePwOpen(false)} />
    </aside>
  );
}
