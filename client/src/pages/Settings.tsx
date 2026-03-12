import { useState, useEffect, useRef } from 'react';
import { useSettings, usePageTitle, SiteSettings } from '@/lib/settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AssetPicker } from '@/components/AssetPicker';
import { Asset, Webhook, WebhookCreated, webhooksApi } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Type, Image as ImageIcon, X, Plus, Trash2, FlaskConical, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ACCENT_PRESETS,
  isValidHex,
  normaliseHex,
  applyAccentColor,
  contrastColor,
} from '@/lib/color';

export default function Settings() {
  usePageTitle('Settings');
  const { settings, update } = useSettings();

  // Webhooks state
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [addingWebhook, setAddingWebhook] = useState(false);
  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<WebhookCreated | null>(null);

  useEffect(() => {
    webhooksApi.list().then(setWebhooks).catch(() => {});
  }, []);

  const handleAddWebhook = async () => {
    if (!newWebhookUrl.trim()) return;
    setAddingWebhook(true);
    try {
      const created = await webhooksApi.create(newWebhookUrl.trim());
      const { secret, ...hook } = created;
      setWebhooks(prev => [{ ...hook, secret_hint: '...' + secret.slice(-4) }, ...prev]);
      setNewWebhookUrl('');
      setShowAddWebhook(false);
      setRevealedSecret(created);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add webhook');
    } finally {
      setAddingWebhook(false);
    }
  };

  const handleToggleWebhook = async (hook: Webhook) => {
    try {
      const updated = await webhooksApi.update(hook.id, { enabled: !hook.enabled });
      setWebhooks(prev => prev.map(h => h.id === hook.id ? updated : h));
    } catch {
      toast.error('Failed to update webhook');
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Delete this webhook?')) return;
    try {
      await webhooksApi.delete(id);
      setWebhooks(prev => prev.filter(h => h.id !== id));
      toast.success('Webhook deleted');
    } catch {
      toast.error('Failed to delete webhook');
    }
  };

  const handleTestWebhook = async (id: string) => {
    setTestingId(id);
    try {
      const result = await webhooksApi.test(id);
      if (result.ok) {
        toast.success(`Test delivered (HTTP ${result.status})`);
      } else {
        toast.error(result.error ?? `Delivery failed (HTTP ${result.status})`);
      }
    } catch {
      toast.error('Test failed');
    } finally {
      setTestingId(null);
    }
  };

  const [siteName, setSiteName] = useState(settings.site_name);
  const [logoType, setLogoType] = useState<'text' | 'image'>(settings.logo_type);
  const [logoImageUrl, setLogoImageUrl] = useState(settings.logo_image_url);
  const [faviconUrl, setFaviconUrl] = useState(settings.favicon_url);
  const [accentColor, setAccentColor] = useState(settings.accent_color);
  const [hexInput, setHexInput] = useState(settings.accent_color);
  const [uploadLimitMb, setUploadLimitMb] = useState(settings.upload_limit_mb);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [faviconPickerOpen, setFaviconPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Sync form state when settings load
  useEffect(() => {
    setSiteName(settings.site_name);
    setLogoType(settings.logo_type);
    setLogoImageUrl(settings.logo_image_url);
    setFaviconUrl(settings.favicon_url);
    setAccentColor(settings.accent_color);
    setHexInput(settings.accent_color);
    setUploadLimitMb(settings.upload_limit_mb);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Partial<SiteSettings> = {
        site_name: siteName,
        logo_type: logoType,
        logo_image_url: logoImageUrl,
        favicon_url: faviconUrl,
        accent_color: accentColor,
        upload_limit_mb: uploadLimitMb,
      };
      await update(payload);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoAssetSelect = (_url: string, asset: Asset) => {
    // Store the full URL for display; it's also what gets saved
    setLogoImageUrl(`/r2/${asset.filename}`);
    setAssetPickerOpen(false);
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Settings</h1>
          <p className="text-zinc-500 text-sm mt-1">Customize the CMS branding and appearance.</p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save Changes
        </Button>
      </div>

      <div className="space-y-6">
        {/* Branding */}
        <section className="bg-white rounded-xl border border-zinc-200 p-5 space-y-5">
          <h2 className="font-semibold text-zinc-800">Branding</h2>

          <div className="space-y-1.5">
            <Label>Site name</Label>
            <Input
              value={siteName}
              onChange={e => setSiteName(e.target.value)}
              placeholder="Etch CMS"
            />
            <p className="text-xs text-zinc-400">Shown in the sidebar and browser tab.</p>
          </div>

          <div className="space-y-2">
            <Label>Logo</Label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setLogoType('text')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 rounded-lg border-2 py-3 text-sm font-medium transition-colors',
                  logoType === 'text'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                )}
              >
                <Type className="h-4 w-4" />
                Text
              </button>
              <button
                type="button"
                onClick={() => setLogoType('image')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 rounded-lg border-2 py-3 text-sm font-medium transition-colors',
                  logoType === 'image'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                )}
              >
                <ImageIcon className="h-4 w-4" />
                Image
              </button>
            </div>

            {logoType === 'image' && (
              <div className="mt-3 space-y-2">
                {logoImageUrl ? (
                  <div className="flex items-center gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-200">
                    <img
                      src={logoImageUrl}
                      alt="Logo"
                      className="h-8 w-auto max-w-40 object-contain"
                    />
                    <div className="flex gap-2 ml-auto">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAssetPickerOpen(true)}
                      >
                        Change
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setLogoImageUrl('')}
                      >
                        <X className="h-4 w-4 text-zinc-400" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAssetPickerOpen(true)}
                    className="w-full flex flex-col items-center gap-2 p-6 border-2 border-dashed border-zinc-200 rounded-lg text-zinc-400 hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
                  >
                    <ImageIcon className="h-7 w-7" />
                    <span className="text-sm">Click to select logo image</span>
                  </button>
                )}
                <p className="text-xs text-zinc-400">
                  SVG or PNG with transparency works best on the dark sidebar.
                </p>
              </div>
            )}
          </div>

          {/* Favicon */}
          <div className="space-y-2">
            <Label>Favicon</Label>
            {faviconUrl ? (
              <div className="flex items-center gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-200">
                <img src={faviconUrl} alt="Favicon" className="h-8 w-8 object-contain" />
                <div className="flex gap-2 ml-auto">
                  <Button type="button" variant="outline" size="sm" onClick={() => setFaviconPickerOpen(true)}>
                    Change
                  </Button>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setFaviconUrl('')}>
                    <X className="h-4 w-4 text-zinc-400" />
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setFaviconPickerOpen(true)}
                className="w-full flex flex-col items-center gap-2 p-6 border-2 border-dashed border-zinc-200 rounded-lg text-zinc-400 hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
              >
                <ImageIcon className="h-7 w-7" />
                <span className="text-sm">Click to select favicon</span>
              </button>
            )}
            <p className="text-xs text-zinc-400">
              ICO, PNG, or SVG — shown in the browser tab. 32×32px or larger recommended.
            </p>
          </div>
        </section>

        {/* Appearance */}
        <section className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
          <h2 className="font-semibold text-zinc-800">Accent Color</h2>
          <p className="text-sm text-zinc-500">
            Used for buttons, links, focus rings, and active states throughout the UI.
          </p>

          {/* Color picker + hex input */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => colorInputRef.current?.click()}
              className="h-10 w-10 rounded-lg border border-zinc-200 shadow-sm shrink-0 overflow-hidden"
              style={{ backgroundColor: isValidHex(accentColor) ? accentColor : '#4f46e5' }}
              title="Open color picker"
            >
              <input
                ref={colorInputRef}
                type="color"
                className="sr-only"
                value={isValidHex(accentColor) ? accentColor : '#4f46e5'}
                onChange={e => {
                  const hex = e.target.value;
                  setAccentColor(hex);
                  setHexInput(hex);
                  applyAccentColor(hex);
                }}
              />
            </button>
            <Input
              value={hexInput}
              onChange={e => {
                const raw = e.target.value;
                setHexInput(raw);
                const normalised = normaliseHex(raw);
                if (isValidHex(normalised)) {
                  setAccentColor(normalised);
                  applyAccentColor(normalised);
                }
              }}
              onBlur={() => {
                const normalised = normaliseHex(hexInput);
                if (isValidHex(normalised)) {
                  setHexInput(normalised);
                  setAccentColor(normalised);
                } else {
                  setHexInput(accentColor);
                }
              }}
              placeholder="#4f46e5"
              className="font-mono w-36"
              maxLength={7}
            />
            <span className="text-sm text-zinc-400">Enter any hex color or use the picker</span>
          </div>

          {/* Quick-pick presets */}
          <div>
            <p className="text-xs text-zinc-400 mb-2">Quick picks</p>
            <div className="flex flex-wrap gap-2">
              {ACCENT_PRESETS.map(preset => {
                const active = accentColor === preset.hex;
                const fg = contrastColor(preset.hex);
                return (
                  <button
                    key={preset.hex}
                    type="button"
                    onClick={() => {
                      setAccentColor(preset.hex);
                      setHexInput(preset.hex);
                      applyAccentColor(preset.hex);
                    }}
                    title={preset.label}
                    className={cn(
                      'h-7 rounded-full px-3 text-xs font-medium transition-transform hover:scale-105',
                      active ? 'ring-2 ring-offset-1' : ''
                    )}
                    style={{
                      backgroundColor: preset.hex,
                      color: fg,
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Preview */}
        <section className="bg-white rounded-xl border border-zinc-200 p-5 space-y-3">
          <h2 className="font-semibold text-zinc-800">Preview</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm">Primary Button</Button>
            <Button size="sm" variant="outline">Outline Button</Button>
            <a href="#" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium" onClick={e => e.preventDefault()}>
              Link text
            </a>
            <span className="inline-flex items-center rounded-md border border-transparent bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
              Badge
            </span>
          </div>
          <p className="text-xs text-zinc-400">Preview updates live as you select a color.</p>
        </section>

        {/* Uploads */}
        <section className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-zinc-800">Uploads</h2>
            <p className="text-sm text-zinc-500 mt-0.5">Maximum file size for uploads through the CMS. For larger files, upload directly to R2 and register them in the asset library.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-32">
              <Input
                type="number"
                min={1}
                max={100}
                value={uploadLimitMb}
                onChange={e => setUploadLimitMb(e.target.value)}
                className="pr-10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400 pointer-events-none">MB</span>
            </div>
            <span className="text-sm text-zinc-500">per file</span>
          </div>
        </section>

        {/* Webhooks */}
        <section className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-zinc-800">Webhooks</h2>
              <p className="text-sm text-zinc-500 mt-0.5">
                Receive an HTTP POST when entries are published, updated, unpublished, or deleted.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowAddWebhook(v => !v)}>
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          </div>

          {showAddWebhook && (
            <div className="flex gap-2 items-start">
              <Input
                value={newWebhookUrl}
                onChange={e => setNewWebhookUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                onKeyDown={e => e.key === 'Enter' && handleAddWebhook()}
                className="flex-1"
              />
              <Button size="sm" onClick={handleAddWebhook} disabled={addingWebhook}>
                {addingWebhook ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowAddWebhook(false); setNewWebhookUrl(''); }}>
                Cancel
              </Button>
            </div>
          )}

          {webhooks.length === 0 && !showAddWebhook ? (
            <p className="text-sm text-zinc-400">No webhooks configured.</p>
          ) : (
            <div className="space-y-3">
              {webhooks.map(hook => (
                <div key={hook.id} className="rounded-lg border border-zinc-200 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-mono text-zinc-800 truncate flex-1">{hook.url}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title="Send test payload"
                        disabled={testingId === hook.id}
                        onClick={() => handleTestWebhook(hook.id)}
                      >
                        {testingId === hook.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <FlaskConical className="h-4 w-4 text-zinc-500" />
                        }
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title="Delete"
                        onClick={() => handleDeleteWebhook(hook.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-zinc-400 shrink-0">Secret</span>
                      <code className="text-xs font-mono text-zinc-500">{hook.secret_hint}</code>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!!hook.enabled}
                      onClick={() => handleToggleWebhook(hook)}
                      className={cn(
                        'relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors',
                        hook.enabled ? 'bg-indigo-600' : 'bg-zinc-200'
                      )}
                    >
                      <span className={cn(
                        'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                        hook.enabled ? 'translate-x-4' : 'translate-x-0'
                      )} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3 space-y-1">
            <p className="text-xs font-medium text-zinc-600">Events fired</p>
            <p className="text-xs text-zinc-500 font-mono">entry.published · entry.updated · entry.unpublished · entry.deleted</p>
            <p className="text-xs text-zinc-400 mt-1">
              Verify requests using the <code className="font-mono">X-Webhook-Signature</code> header (HMAC-SHA256 of the raw body, keyed with the secret above).
            </p>
          </div>
        </section>
      </div>

      <Dialog open={!!revealedSecret} onOpenChange={open => { if (!open) setRevealedSecret(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook secret</DialogTitle>
            <DialogDescription>
              Copy this secret now — it won't be shown again. Use it to verify the <code className="font-mono">X-Webhook-Signature</code> header on incoming requests.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 mt-2 p-3 bg-zinc-50 rounded-lg border border-zinc-200">
            <code className="text-sm font-mono text-zinc-800 flex-1 break-all">{revealedSecret?.secret}</code>
            <button
              type="button"
              title="Copy secret"
              onClick={() => {
                if (revealedSecret) {
                  navigator.clipboard.writeText(revealedSecret.secret);
                  toast.success('Copied');
                }
              }}
              className="shrink-0 text-zinc-400 hover:text-zinc-600"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <Button className="w-full mt-2" onClick={() => setRevealedSecret(null)}>Done</Button>
        </DialogContent>
      </Dialog>

      <AssetPicker
        open={assetPickerOpen}
        onClose={() => setAssetPickerOpen(false)}
        onSelect={handleLogoAssetSelect}
      />
      <AssetPicker
        open={faviconPickerOpen}
        onClose={() => setFaviconPickerOpen(false)}
        onSelect={(_url, asset) => {
          setFaviconUrl(`/r2/${asset.filename}`);
          setFaviconPickerOpen(false);
        }}
      />
    </div>
  );
}
