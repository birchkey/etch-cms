import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { applyAccentColor, isValidHex } from './color';
import { settingsApi } from './api';

export interface SiteSettings {
  site_name: string;
  logo_type: 'text' | 'image';
  logo_image_url: string;
  login_logo_image_url: string;
  accent_color: string;
  favicon_url: string;
  upload_limit_mb: string;
  /** Read-only, from the Worker's ASSETS_HOSTNAME. Empty when no files domain is configured. */
  assets_hostname: string;
}

const DEFAULTS: SiteSettings = {
  site_name: 'Etch CMS',
  logo_type: 'text',
  logo_image_url: '',
  login_logo_image_url: '',
  accent_color: '#4f46e5',
  favicon_url: '',
  upload_limit_mb: '50',
  assets_hostname: '',
};

function applyFavicon(url: string) {
  const id = 'cms-favicon';
  let el = document.getElementById(id) as HTMLLinkElement | null;
  if (!url) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('link');
    el.id = id;
    el.rel = 'icon';
    document.head.appendChild(el);
  }
  // Cache-bust so the browser treats this as a new resource rather than
  // serving a cached 404 or previous icon from an earlier visit.
  el.href = `${url}?t=${Date.now()}`;
}

async function fetchSettings(signal?: AbortSignal): Promise<Partial<SiteSettings>> {
  const res = await fetch('/api/settings', { signal });
  if (!res.ok) throw new Error(`GET /api/settings failed: ${res.status}`);
  return await res.json() as Partial<SiteSettings>;
}

// Branding is fetched once on mount and never re-requested, so a single transient failure
// used to leave the user looking at the default name, favicon and colors for the rest of the
// page load — only a manual refresh recovered it. Retry on a short backoff instead, so the
// page corrects itself within a few seconds.
const RETRY_DELAYS_MS = [400, 1200, 3000, 8000];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface SettingsContextValue {
  settings: SiteSettings;
  refresh: () => Promise<void>;
  update: (partial: Partial<SiteSettings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULTS);

  const apply = useCallback((s: SiteSettings) => {
    setSettings(s);
    document.title = s.site_name || 'Etch CMS';
    applyFavicon(s.favicon_url);
    if (isValidHex(s.accent_color)) {
      applyAccentColor(s.accent_color);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply({ ...DEFAULTS, ...await fetchSettings() });
    } catch {
      // Caller-initiated refresh of already-applied branding — keep what's on screen.
    }
  }, [apply]);

  const update = useCallback(async (partial: Partial<SiteSettings>) => {
    const data = await settingsApi.update(partial);
    apply({ ...DEFAULTS, ...data });
  }, [apply]);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const data = await fetchSettings(controller.signal);
          apply({ ...DEFAULTS, ...data });
          return;
        } catch {
          if (controller.signal.aborted || attempt >= RETRY_DELAYS_MS.length) return;
          await sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
    })();

    return () => controller.abort();
  }, [apply]);

  return (
    <SettingsContext.Provider value={{ settings, refresh, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

export function usePageTitle(title: string) {
  const { settings } = useSettings();
  useEffect(() => {
    document.title = title ? `${title} | ${settings.site_name}` : settings.site_name;
    return () => { document.title = settings.site_name; };
  }, [title, settings.site_name]);
}
