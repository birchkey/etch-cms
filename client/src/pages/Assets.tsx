import { useEffect, useState, useRef } from 'react';
import { assetsApi, Asset, PaginatedResponse } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, Search, Trash2, Copy, Loader2, FileText, ChevronLeft, ChevronRight, Link, Globe, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { usePageTitle, useSettings } from '@/lib/settings';

function AltTextInput({ asset, onSave }: { asset: Asset; onSave: (id: string, alt: string) => void }) {
  const [value, setValue] = useState(asset.alt_text ?? '');
  return (
    <input
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={() => onSave(asset.id, value)}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="Add alt text…"
      className="w-full mt-1 text-xs text-zinc-500 bg-transparent border-b border-transparent hover:border-zinc-200 focus:border-zinc-400 focus:outline-none placeholder:text-zinc-300 truncate"
    />
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PAGE_SIZE = 50;

export default function Assets() {
  usePageTitle('Assets');
  const { settings } = useSettings();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [meta, setMeta] = useState<PaginatedResponse<Asset>['meta'] | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [registerKey, setRegisterKey] = useState('');
  const [registerAlt, setRegisterAlt] = useState('');
  const [registering, setRegistering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setLoading(true);
    assetsApi.list({ page, limit: PAGE_SIZE, search: debouncedSearch || undefined })
      .then(res => {
        setAssets(res.data);
        setMeta(res.meta);
      })
      .catch(() => toast.error('Failed to load assets'))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch]);

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const results = await Promise.allSettled(
      Array.from(files).map(f => assetsApi.upload(f))
    );
    const uploaded: Asset[] = [];
    let failed = 0;
    results.forEach(r => {
      if (r.status === 'fulfilled') uploaded.push(r.value);
      else failed++;
    });
    if (uploaded.length) {
      setAssets(prev => [...uploaded, ...prev]);
      if (meta) setMeta({ ...meta, total: meta.total + uploaded.length });
      toast.success(`Uploaded ${uploaded.length} file${uploaded.length > 1 ? 's' : ''}`);
    }
    if (failed) toast.error(`${failed} upload${failed > 1 ? 's' : ''} failed`);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRegister = async () => {
    if (!registerKey.trim()) return;
    setRegistering(true);
    try {
      const asset = await assetsApi.register({ r2_key: registerKey.trim(), alt_text: registerAlt.trim() || null });
      setAssets(prev => [asset, ...prev]);
      if (meta) setMeta({ ...meta, total: meta.total + 1 });
      setRegisterKey('');
      setRegisterAlt('');
      setShowRegister(false);
      toast.success('Asset registered');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to register asset');
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (asset: Asset) => {
    if (!confirm(`Delete "${asset.original_name}"?`)) return;
    setDeleting(asset.id);
    try {
      await assetsApi.delete(asset.id);
      setAssets(prev => prev.filter(a => a.id !== asset.id));
      if (meta) setMeta({ ...meta, total: meta.total - 1 });
      toast.success('Deleted');
    } catch {
      toast.error('Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  const handleAltSave = async (id: string, altText: string) => {
    try {
      const updated = await assetsApi.update(id, { alt_text: altText || null });
      setAssets(prev => prev.map(a => a.id === id ? updated : a));
    } catch {
      toast.error('Failed to save alt text');
    }
  };

  const handleTogglePublic = async (asset: Asset) => {
    try {
      const updated = await assetsApi.update(asset.id, { is_public: !asset.is_public });
      setAssets(prev => prev.map(a => a.id === asset.id ? updated : a));
      toast.success(updated.is_public ? 'Asset is now publicly accessible' : 'Asset is now private');
    } catch {
      toast.error('Failed to update asset');
    }
  };

  const copyUrl = (asset: Asset) => {
    const url = `${window.location.origin}${assetsApi.url(asset.r2_key)}`;
    navigator.clipboard.writeText(url);
    toast.success('URL copied!');
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-zinc-900">Assets</h1>
          <p className="text-zinc-500 text-sm mt-1">Manage uploaded files and images. Accepts JPEG, PNG, GIF, WebP, AVIF, SVG, ICO, PDF, MP4, and WebM.</p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowRegister(v => !v)}>
              <Link className="h-4 w-4 mr-2" />
              Register R2 Asset
            </Button>
            <label className="cursor-pointer">
              <Button asChild disabled={uploading}>
                <span>
                  {uploading
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <Upload className="h-4 w-4 mr-2" />
                  }
                  Upload Files
                </span>
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept="image/*,video/*,application/pdf"
                onChange={e => handleUpload(e.target.files)}
              />
            </label>
          </div>
          <p className="text-xs text-zinc-400">Max {settings.upload_limit_mb} MB per file</p>
        </div>
      </div>

      {showRegister && (
        <div className="mb-4 p-4 bg-white rounded-xl border border-zinc-200 space-y-3">
          <p className="text-sm font-medium text-zinc-700">Register an existing R2 object as an asset</p>
          <div className="space-y-1.5">
            <Label>R2 key</Label>
            <Input
              placeholder="videos/my-file.mp4 or assets/videos/my-file.mp4"
              value={registerKey}
              onChange={e => setRegisterKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRegister()}
            />
            <p className="text-xs text-zinc-400">The object key in your R2 bucket. The <code className="font-mono">assets/</code> prefix is added automatically if omitted.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Alt text <span className="text-zinc-400 font-normal">(optional)</span></Label>
            <Input
              placeholder="Describe the file for accessibility"
              value={registerAlt}
              onChange={e => setRegisterAlt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRegister()}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleRegister} disabled={registering || !registerKey.trim()}>
              {registering ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Register
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowRegister(false); setRegisterKey(''); setRegisterAlt(''); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="relative mb-4">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
        <Input
          placeholder="Search assets..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : assets.length === 0 ? (
        <div
          className="text-center py-20 bg-white rounded-xl border-2 border-dashed border-zinc-200 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/20 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-12 w-12 text-zinc-300 mx-auto mb-4" />
          <p className="text-zinc-600 font-medium">{debouncedSearch ? 'No matching files' : 'No assets yet'}</p>
          <p className="text-zinc-400 text-sm mt-1">{debouncedSearch ? '' : 'Click to upload files'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {assets.map(asset => {
            const url = assetsApi.url(asset.r2_key);
            const isImage = asset.content_type.startsWith('image/');

            return (
              <div
                key={asset.id}
                className="group bg-white rounded-xl border border-zinc-200 overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Image thumbnail with hover overlay */}
                <div className="relative aspect-square bg-zinc-100 flex items-center justify-center overflow-hidden">
                  {isImage ? (
                    <img src={url} alt={asset.alt_text ?? asset.original_name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <FileText className="h-10 w-10" />
                      <span className="text-xs font-mono uppercase">
                        {asset.content_type.split('/')[1]?.slice(0, 4) ?? 'file'}
                      </span>
                    </div>
                  )}
                  {asset.is_public ? (
                    <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-green-500 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-md">
                      <Globe className="h-2.5 w-2.5" />
                      Public
                    </div>
                  ) : null}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      onClick={() => copyUrl(asset)}
                      className="p-2 bg-white rounded-lg hover:bg-zinc-100 transition-colors"
                      title="Copy URL"
                    >
                      <Copy className="h-4 w-4 text-zinc-700" />
                    </button>
                    <button
                      onClick={() => handleTogglePublic(asset)}
                      className="p-2 bg-white rounded-lg hover:bg-zinc-100 transition-colors"
                      title={asset.is_public ? 'Make private' : 'Make public (permanent URL)'}
                    >
                      {asset.is_public
                        ? <Lock className="h-4 w-4 text-zinc-700" />
                        : <Globe className="h-4 w-4 text-zinc-700" />
                      }
                    </button>
                    <button
                      onClick={() => handleDelete(asset)}
                      disabled={deleting === asset.id}
                      className="p-2 bg-white rounded-lg hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      {deleting === asset.id
                        ? <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
                        : <Trash2 className="h-4 w-4 text-red-500" />
                      }
                    </button>
                  </div>
                </div>

                <div className="p-2.5">
                  <p className="text-xs font-medium text-zinc-800 truncate" title={asset.original_name}>
                    {asset.original_name}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">{formatBytes(asset.size)}</p>
                  <AltTextInput key={asset.id} asset={asset} onSave={handleAltSave} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-zinc-500">
            Page {page} of {meta.pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!meta.has_next}
            onClick={() => setPage(p => p + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {!loading && meta && (
        <p className="text-xs text-zinc-400 text-center mt-4">
          {meta.total} asset{meta.total !== 1 ? 's' : ''} total
        </p>
      )}
    </div>
  );
}
