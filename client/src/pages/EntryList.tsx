import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { contentTypesApi, entriesApi, ContentType, Entry, PaginatedResponse } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { Input } from '@/components/ui/input';
import { Plus, Loader2, FileText, Trash2, Pencil, Globe, EyeOff, Search, Copy, ChevronLeft, ChevronRight, X, ArrowUp, ArrowDown, Download, GripVertical } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { usePageTitle } from '@/lib/settings';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const PAGE_SIZE = 50;

function SortableEntryRow({ entry, label }: { entry: Entry; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-4 px-5 py-3.5 bg-white ${isDragging ? 'shadow-lg z-10 relative opacity-80' : ''}`}
    >
      <button
        className="cursor-grab active:cursor-grabbing text-zinc-300 hover:text-zinc-500 shrink-0 touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-zinc-900 text-sm truncate">{label}</p>
        <p className="text-xs text-zinc-400 mt-0.5">{new Date(entry.created_at).toLocaleDateString()}</p>
      </div>
      <StatusBadge status={entry.status} hasChanges={!!entry.has_unpublished_changes} />
    </div>
  );
}

export default function EntryList() {
  const { typeId } = useParams<{ typeId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin } = useAuth();
  const [contentType, setContentType] = useState<ContentType | null>(null);
  usePageTitle(contentType?.name ?? '');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [meta, setMeta] = useState<PaginatedResponse<Entry>['meta'] | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderEntries, setReorderEntries] = useState<Entry[]>([]);
  const [reorderSaving, setReorderSaving] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor));
  const [refreshKey, setRefreshKey] = useState(0);
  const statusFilter = searchParams.get('status') ?? '';
  const sortBy = searchParams.get('sort_by') ?? 'sort_order';
  const sortDir = (searchParams.get('sort_dir') ?? 'asc') as 'asc' | 'desc';

  // Merge a single param change, preserving all others. Omit defaults to keep URLs clean.
  const setParam = (key: string, val: string | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (val) next.set(key, val); else next.delete(key);
      return next;
    }, { replace: true });
  };

  useEffect(() => {
    setPage(1);
    setSearch('');
    setDebouncedSearch('');
    setSelected(new Set());
  }, [typeId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setSelected(new Set());
  }, [page]);

  useEffect(() => {
    if (!typeId) return;
    setLoading(true);
    Promise.all([
      contentTypesApi.get(typeId),
      contentTypesApi.listEntries(typeId, { page, limit: PAGE_SIZE, status: statusFilter || undefined, sort_by: sortBy, sort_dir: sortDir, q: debouncedSearch || undefined }),
    ])
      .then(([ct, res]) => {
        setContentType(ct);
        setEntries(res.data);
        setMeta(res.meta);
      })
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  }, [typeId, page, statusFilter, sortBy, sortDir, debouncedSearch, refreshKey]);

  const handleDuplicate = async (entry: Entry) => {
    try {
      const copy = await entriesApi.duplicate(entry.id);
      setEntries(prev => [copy, ...prev]);
      toast.success('Duplicated as draft');
    } catch {
      toast.error('Duplicate failed');
    }
  };

  const handleDelete = async (entry: Entry) => {
    if (!confirm('Delete this entry?')) return;
    try {
      await entriesApi.delete(entry.id);
      setEntries(prev => prev.filter(e => e.id !== entry.id));
      if (meta) setMeta({ ...meta, total: meta.total - 1 });
      toast.success('Deleted');
    } catch {
      toast.error('Delete failed');
    }
  };

  const handlePublish = async (entry: Entry) => {
    try {
      if (entry.status === 'published') {
        const updated = await entriesApi.unpublish(entry.id);
        setEntries(prev => prev.map(e => e.id === entry.id ? updated : e));
        toast.success('Unpublished');
      } else {
        const result = await entriesApi.publish(entry.id);
        setEntries(prev => prev.map(e => e.id === entry.id ? result : e));
        toast.success('Published');
        result.warnings.forEach(w => toast.warning(w));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} entr${selected.size === 1 ? 'y' : 'ies'}?`)) return;
    setBulkLoading(true);
    const ids = [...selected];
    const results = await Promise.allSettled(ids.map(id => entriesApi.delete(id)));
    const deleted = ids.filter((_, i) => results[i].status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected').length;
    if (deleted.length) {
      setEntries(prev => prev.filter(e => !deleted.includes(e.id)));
      if (meta) setMeta({ ...meta, total: meta.total - deleted.length });
      setSelected(new Set());
      toast.success(`Deleted ${deleted.length} entr${deleted.length === 1 ? 'y' : 'ies'}`);
    }
    if (failed) toast.error(`${failed} deletion${failed === 1 ? '' : 's'} failed`);
    setBulkLoading(false);
  };

  const handleBulkPublish = async () => {
    setBulkLoading(true);
    const ids = [...selected];
    const results = await Promise.allSettled(ids.map(id => entriesApi.publish(id)));
    const published = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
    const failed = results.filter(r => r.status === 'rejected').length;
    if (published.length) {
      setEntries(prev => prev.map(e => published.find(u => u.id === e.id) ?? e));
      setSelected(new Set());
      toast.success(`Published ${published.length} entr${published.length === 1 ? 'y' : 'ies'}`);
      const warnings = published.flatMap(r => r.warnings);
      if (warnings.length) toast.warning(`Some entries have unpublished related entries`);
    }
    if (failed) toast.error(`${failed} entr${failed === 1 ? 'y' : 'ies'} failed to publish`);
    setBulkLoading(false);
  };

  const handleBulkUnpublish = async () => {
    setBulkLoading(true);
    const ids = [...selected];
    const results = await Promise.allSettled(ids.map(id => entriesApi.unpublish(id)));
    const updated: Entry[] = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
    const failed = results.filter(r => r.status === 'rejected').length;
    if (updated.length) {
      setEntries(prev => prev.map(e => updated.find(u => u.id === e.id) ?? e));
      setSelected(new Set());
      toast.success(`Unpublished ${updated.length} entr${updated.length === 1 ? 'y' : 'ies'}`);
    }
    if (failed) toast.error(`${failed} entr${failed === 1 ? 'y' : 'ies'} failed to unpublish`);
    setBulkLoading(false);
  };

  const enterReorderMode = async () => {
    try {
      const res = await contentTypesApi.listEntries(typeId!, { limit: 1000 });
      setReorderEntries(res.data);
      setReorderMode(true);
    } catch {
      toast.error('Failed to load entries for reordering');
    }
  };

  const exitReorderMode = () => {
    setReorderMode(false);
    setReorderEntries([]);
    setRefreshKey(k => k + 1);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = reorderEntries.findIndex(e => e.id === active.id);
    const newIndex = reorderEntries.findIndex(e => e.id === over.id);
    const reordered = arrayMove(reorderEntries, oldIndex, newIndex);
    setReorderEntries(reordered);
    setReorderSaving(true);
    try {
      await contentTypesApi.reorderEntries(typeId!, reordered.map(e => e.id));
      toast.success('Order saved');
    } catch {
      toast.error('Failed to save order');
      setReorderEntries(reorderEntries); // revert
    } finally {
      setReorderSaving(false);
    }
  };

  const handleExport = async (format: 'json' | 'csv') => {
    setExportOpen(false);
    try {
      const { blob, filename } = await contentTypesApi.exportEntries(typeId!, { format, status: statusFilter || undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const getEntryLabel = (entry: Entry): string => {
    const firstTextField = contentType?.fields?.find(f => f.type === 'text' || f.type === 'rich_text');
    if (firstTextField) {
      const val = entry.fields[firstTextField.slug];
      if (typeof val === 'string') {
        return val.replace(/<[^>]+>/g, '').slice(0, 80) || `Entry ${entry.id.slice(0, 8)}`;
      }
    }
    return `Entry ${entry.id.slice(0, 8)}`;
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;
  }

  if (reorderMode) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Reorder</p>
            <h1 className="text-2xl font-bold text-zinc-900">{contentType?.name}</h1>
            <p className="text-xs text-zinc-400 mt-0.5">Drag entries to set their display order.</p>
          </div>
          <Button variant="outline" onClick={exitReorderMode} disabled={reorderSaving}>
            {reorderSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Done
          </Button>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={reorderEntries.map(e => e.id)} strategy={verticalListSortingStrategy}>
            <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
              {reorderEntries.map(entry => (
                <SortableEntryRow key={entry.id} entry={entry} label={getEntryLabel(entry)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Content</p>
          <h1 className="text-2xl font-bold text-zinc-900">{contentType?.name}</h1>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Link to={`/content-types/${typeId}`}>
              <Button variant="outline" size="sm">Edit Collection</Button>
            </Link>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={enterReorderMode}>
              <GripVertical className="h-4 w-4 mr-2" />
              Reorder
            </Button>
          )}
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => setExportOpen(o => !o)}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg py-1 z-10 min-w-28">
                <button onClick={() => handleExport('json')} className="w-full text-left px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50">JSON</button>
                <button onClick={() => handleExport('csv')} className="w-full text-left px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50">CSV</button>
              </div>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => navigate(`/content-types/${typeId}/entries/new`)}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Entry
          </Button>
        </div>
      </div>

      {/* Filter + sort bar — always visible once loaded */}
      <div className="flex items-center gap-3 mb-4">
        {/* Status tabs */}
        <div className="flex rounded-lg border border-zinc-200 overflow-hidden text-sm bg-white">
          {([['', 'All'], ['draft', 'Draft'], ['scheduled', 'Scheduled'], ['published', 'Published'], ['changes', 'Has Changes']] as [string, string][]).map(([val, label]) => (
            <button
              key={val}
              onClick={() => { setParam('status', val || null); setPage(1); setSelected(new Set()); }}
              className={`px-3 py-1.5 transition-colors ${statusFilter === val ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Select value={sortBy} onValueChange={v => { setParam('sort_by', v === 'sort_order' ? null : v); setParam('sort_dir', null); setPage(1); }}>
            <SelectTrigger className="h-8 text-sm w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sort_order">Custom Order</SelectItem>
              <SelectItem value="created_at">Created</SelectItem>
              <SelectItem value="updated_at">Updated</SelectItem>
              <SelectItem value="published_at">Published</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => { setParam('sort_dir', sortDir === 'asc' ? 'desc' : null); setPage(1); }}
            className="flex items-center justify-center h-8 w-8 rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors text-zinc-600"
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search entries…"
          className="pl-9"
        />
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-indigo-600 text-white rounded-xl px-5 py-3 mb-4">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-1.5 ml-auto">
            <Button size="sm" variant="ghost" className="text-white hover:bg-indigo-700 hover:text-white" disabled={bulkLoading} onClick={handleBulkPublish}>
              <Globe className="h-4 w-4 mr-1.5" />Publish
            </Button>
            <Button size="sm" variant="ghost" className="text-white hover:bg-indigo-700 hover:text-white" disabled={bulkLoading} onClick={handleBulkUnpublish}>
              <EyeOff className="h-4 w-4 mr-1.5" />Unpublish
            </Button>
            <Button size="sm" variant="ghost" className="text-white hover:bg-red-600 hover:text-white" disabled={bulkLoading} onClick={handleBulkDelete}>
              <Trash2 className="h-4 w-4 mr-1.5" />Delete
            </Button>
            <button onClick={() => setSelected(new Set())} className="ml-1 p-1 rounded hover:bg-indigo-700 transition-colors" title="Clear selection">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 && !debouncedSearch && !meta?.total ? (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-zinc-200">
          <FileText className="h-12 w-12 text-zinc-300 mx-auto mb-4" />
          <p className="text-zinc-600 font-medium">No entries yet</p>
          <p className="text-zinc-400 text-sm mt-1 mb-6">Create your first entry for {contentType?.name}.</p>
          <Button onClick={() => navigate(`/content-types/${typeId}/entries/new`)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Entry
          </Button>
        </div>
      ) : entries.length === 0 ? (
        <p className="text-center py-12 text-zinc-400 text-sm">No entries match your search</p>
      ) : (
        <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
          {/* Select-all header */}
          <div className="flex items-center gap-4 px-5 py-2.5 bg-zinc-50 border-b border-zinc-200">
            <input
              type="checkbox"
              checked={entries.length > 0 && entries.every(e => selected.has(e.id))}
              ref={el => { if (el) el.indeterminate = selected.size > 0 && !entries.every(e => selected.has(e.id)); }}
              onChange={e => {
                if (e.target.checked) {
                  setSelected(new Set(entries.map(e => e.id)));
                } else {
                  setSelected(new Set());
                }
              }}
              className="rounded border-zinc-300"
            />
            <span className="text-xs text-zinc-400">
              {selected.size > 0 ? `${selected.size} of ${entries.length} selected` : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
            </span>
          </div>
          {entries.map(entry => (
            <div key={entry.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-50 group transition-colors">
              <input
                type="checkbox"
                checked={selected.has(entry.id)}
                onChange={() => toggleSelect(entry.id)}
                onClick={e => e.stopPropagation()}
                className="rounded border-zinc-300 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-zinc-900 text-sm truncate">{getEntryLabel(entry)}</p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {new Date(entry.created_at).toLocaleDateString()}
                  {entry.status === 'scheduled' && entry.scheduled_at && ` · Scheduled for ${new Date(entry.scheduled_at).toLocaleString()}`}
                  {entry.status === 'published' && entry.published_at && ` · Published ${new Date(entry.published_at).toLocaleDateString()}`}
                </p>
              </div>
              <StatusBadge status={entry.status} hasChanges={!!entry.has_unpublished_changes} />
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  title={entry.status === 'published' ? 'Unpublish' : entry.status === 'scheduled' ? 'Publish Now' : 'Publish'}
                  onClick={() => handlePublish(entry)}
                >
                  {entry.status === 'published'
                    ? <EyeOff className="h-4 w-4 text-zinc-500" />
                    : <Globe className="h-4 w-4 text-zinc-500" />
                  }
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Duplicate"
                  onClick={() => handleDuplicate(entry)}
                >
                  <Copy className="h-4 w-4 text-zinc-500" />
                </Button>
                <Link to={`/content-types/${typeId}/entries/${entry.id}`}>
                  <Button variant="ghost" size="icon" title="Edit">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete"
                  onClick={() => handleDelete(entry)}
                >
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </div>
            </div>
          ))}
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
    </div>
  );
}
