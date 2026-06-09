import { useEffect, useState } from 'react';
import { assetsApi, Asset } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Check, Loader2, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';

interface AssetPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string, asset: Asset) => void;
  multiSelect?: boolean;
  onSelectMultiple?: (urls: string[]) => void;
}

export function AssetPicker({ open, onClose, onSelect, multiSelect, onSelectMultiple }: AssetPickerProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
      setLoading(true);
      assetsApi.list({ limit: 1000 })
        .then(res => setAssets(res.data))
        .catch(() => toast.error('Failed to load assets'))
        .finally(() => setLoading(false));
    }
  }, [open]);

  const filtered = assets.filter(a =>
    a.original_name.toLowerCase().includes(search.toLowerCase())
  );

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const asset = await assetsApi.upload(file);
      setAssets(prev => [asset, ...prev]);
      toast.success('Uploaded');
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleAssetClick = (asset: Asset) => {
    const url = assetsApi.url(asset.r2_key);
    if (multiSelect) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(asset.id)) next.delete(asset.id);
        else next.add(asset.id);
        return next;
      });
    } else {
      onSelect(url, asset);
    }
  };

  const handleConfirm = () => {
    const urls = assets
      .filter(a => selectedIds.has(a.id))
      .map(a => assetsApi.url(a.r2_key));
    onSelectMultiple?.(urls);
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl flex flex-col max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{multiSelect ? 'Select Assets' : 'Select Asset'}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              placeholder="Search assets..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <label>
            <Button asChild variant="outline" size="sm" className="cursor-pointer">
              <span>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                Upload
              </span>
            </Button>
            <input type="file" className="hidden" onChange={handleUpload} accept="image/*,video/*,application/pdf" />
          </label>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 text-sm">
            No assets found. Upload one to get started.
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 min-h-0">
            <div className="grid grid-cols-3 gap-3">
              {filtered.map(asset => {
                const url = assetsApi.url(asset.r2_key);
                const isImage = asset.content_type.startsWith('image/');
                const selected = selectedIds.has(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => handleAssetClick(asset)}
                    className={`group relative aspect-square rounded-md border overflow-hidden transition-all ${
                      selected
                        ? 'border-indigo-500 ring-2 ring-indigo-300'
                        : 'border-zinc-200 hover:border-indigo-500 hover:ring-2 hover:ring-indigo-300'
                    }`}
                  >
                    {isImage ? (
                      <img src={url} alt={asset.original_name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-zinc-100 text-zinc-400 text-xs text-center p-2">
                        {asset.original_name}
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-xs p-1 truncate opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      {asset.original_name}
                    </div>
                    {selected && (
                      <div className="absolute top-1.5 right-1.5 bg-indigo-500 rounded-full p-0.5">
                        <Check className="h-3 w-3 text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {multiSelect && (
          <div className="shrink-0 border-t border-zinc-100 pt-3 flex justify-end">
            <Button onClick={handleConfirm} disabled={selectedIds.size === 0}>
              Add {selectedIds.size > 0 ? `${selectedIds.size} asset${selectedIds.size !== 1 ? 's' : ''}` : 'assets'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
