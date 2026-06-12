import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useState } from 'react';
import { Menu, Database } from 'lucide-react';
import { useSettings } from '@/lib/settings';

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { settings } = useSettings();

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Mobile top header */}
      <header className="md:hidden fixed top-0 inset-x-0 z-50 h-14 bg-zinc-900 border-b border-zinc-800 flex items-center gap-3 px-4">
        <button
          onClick={() => setSidebarOpen(true)}
          className="text-zinc-400 hover:text-white transition-colors p-1 -ml-1"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        {settings.logo_type === 'image' && settings.logo_image_url ? (
          <img src={settings.logo_image_url} alt={settings.site_name} className="h-7 w-auto object-contain" />
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <Database className="h-4 w-4 text-indigo-400 shrink-0" />
            <span className="text-white font-semibold text-sm truncate">{settings.site_name || 'Etch CMS'}</span>
          </div>
        )}
      </header>

      {/* Sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="md:ml-60 min-h-screen pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
}
