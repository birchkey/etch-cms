import { useState, useEffect, useRef } from 'react';
import { Field, contentTypesApi } from '@/lib/api';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { RichTextEditor } from './RichTextEditor';
import { AssetPicker } from './AssetPicker';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Image as ImageIcon, X, Plus, ExternalLink } from 'lucide-react';

interface FieldValueEditorProps {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function FieldValueEditor({ field, value, onChange }: FieldValueEditorProps) {
  switch (field.type) {
    case 'text':
      return (
        <Input
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={field.name}
        />
      );

    case 'rich_text': {
      const allowedExtensions = field.rich_text_extensions
        ? JSON.parse(field.rich_text_extensions) as string[]
        : null;
      return (
        <RichTextEditor
          value={(value as string) ?? ''}
          onChange={onChange}
          placeholder={`Write ${field.name}...`}
          allowedExtensions={allowedExtensions}
        />
      );
    }

    case 'number':
      return (
        <Input
          type="number"
          value={(value as number) ?? ''}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder="0"
        />
      );

    case 'datetime':
      return (
        <Input
          type="datetime-local"
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
        />
      );

    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <Switch
            checked={!!value}
            onCheckedChange={onChange}
          />
          <Label className="text-zinc-600">{value ? 'Yes' : 'No'}</Label>
        </div>
      );

    case 'image':
      return field.multiple === 1
        ? <MultiImageEditor value={value as string[] | null} onChange={onChange} />
        : <ImageFieldEditor value={value as string | null} onChange={onChange} />;

    case 'select': {
      const options = field.select_options
        ? JSON.parse(field.select_options) as string[]
        : [];

      if (field.multiple === 1) {
        const selected = (value as string[] | null) ?? [];
        return (
          <div className="border border-zinc-200 rounded-md divide-y divide-zinc-100 max-h-48 overflow-y-auto">
            {options.length === 0 ? (
              <p className="p-3 text-sm text-zinc-400">No options defined</p>
            ) : (
              options.map(opt => (
                <label key={opt} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-zinc-50">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt)}
                    onChange={() => {
                      if (selected.includes(opt)) {
                        onChange(selected.filter(s => s !== opt));
                      } else {
                        onChange([...selected, opt]);
                      }
                    }}
                    className="rounded border-zinc-300"
                  />
                  <span className="text-sm">{opt}</span>
                </label>
              ))
            )}
          </div>
        );
      }

      return (
        <Select
          value={(value as string) ?? '__none__'}
          onValueChange={v => onChange(v === '__none__' ? null : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— None —</SelectItem>
            {options.map(opt => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case 'relation':
      return (
        <RelationFieldEditor
          field={field}
          value={value}
          onChange={onChange}
        />
      );

    default:
      return (
        <Input
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
        />
      );
  }
}

function ImageFieldEditor({ value, onChange }: { value: string | null; onChange: (v: unknown) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="space-y-3">
      {value ? (
        <div className="inline-flex flex-col items-start gap-2">
          <div className="relative">
            <img src={value} alt="Selected" className="max-h-48 rounded-md border border-zinc-200" />
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute -top-2 -right-2 bg-white rounded-full border border-zinc-200 p-0.5 hover:bg-zinc-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            Change image
          </Button>
        </div>
      ) : (
        <div
          onClick={() => setPickerOpen(true)}
          className="border-2 border-dashed border-zinc-200 rounded-md p-8 flex flex-col items-center gap-2 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
        >
          <ImageIcon className="h-8 w-8 text-zinc-300" />
          <span className="text-sm text-zinc-500">Click to select image</span>
        </div>
      )}
      <AssetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(url) => {
          onChange(url);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

function MultiImageEditor({ value, onChange }: { value: string[] | null; onChange: (v: unknown) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const images = value ?? [];

  const remove = (index: number) => {
    onChange(images.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {images.map((url, i) => (
            <div key={i} className="relative">
              <img src={url} alt={`Image ${i + 1}`} className="h-32 w-32 object-cover rounded-md border border-zinc-200" />
              <button
                type="button"
                onClick={() => remove(i)}
                className="absolute -top-2 -right-2 bg-white rounded-full border border-zinc-200 p-0.5 hover:bg-zinc-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
        <ImageIcon className="h-4 w-4 mr-2" />
        {images.length === 0 ? 'Add image' : 'Add another image'}
      </Button>
      <AssetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(url) => {
          onChange([...images, url]);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles =
    status === 'published' ? 'bg-green-100 text-green-700' :
    status === 'scheduled' ? 'bg-blue-50 text-blue-700' :
    'bg-zinc-100 text-zinc-500';
  const label =
    status === 'published' ? 'Published' :
    status === 'scheduled' ? 'Scheduled' : 'Draft';
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${styles}`}>{label}</span>;
}

function RelationFieldEditor({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [options, setOptions] = useState<{ id: string; label: string; status: string }[]>([]);
  const [ctName, setCtName] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!field.relation_content_type_id) return;
    setLoading(true);
    Promise.all([
      contentTypesApi.get(field.relation_content_type_id),
      contentTypesApi.selectEntries(field.relation_content_type_id),
    ])
      .then(([ct, entries]) => { setCtName(ct.name); setOptions(entries); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [field.relation_content_type_id]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!field.relation_content_type_id) {
    return <p className="text-sm text-zinc-400">No target content type configured.</p>;
  }
  if (loading) {
    return <p className="text-sm text-zinc-400">Loading...</p>;
  }

  const isMany = field.relation_cardinality === 'many';
  const selectedIds: string[] = isMany
    ? (value as string[] | null) ?? []
    : value ? [value as string] : [];

  const selectedEntries = selectedIds
    .map(id => options.find(o => o.id === id))
    .filter((o): o is { id: string; label: string; status: string } => !!o);

  const available = options.filter(o => !selectedIds.includes(o.id));
  const filtered = search
    ? available.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : available;

  const add = (id: string) => {
    onChange(isMany ? [...selectedIds, id] : id);
    setOpen(false);
    setSearch('');
  };

  const remove = (id: string) => {
    onChange(isMany ? selectedIds.filter(s => s !== id) : null);
  };

  const showAddButton = isMany || selectedIds.length === 0;

  return (
    <div className="space-y-2">
      {selectedEntries.map(entry => (
        <div key={entry.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-zinc-200 bg-white">
          <span className="flex-1 text-sm text-zinc-900 truncate">{entry.label}</span>
          <StatusPill status={entry.status} />
          <a
            href={`/content-types/${field.relation_content_type_id}/entries/${entry.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-zinc-400 hover:text-zinc-600 transition-colors"
            title="Edit in new tab"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <button type="button" onClick={() => remove(entry.id)} className="text-zinc-400 hover:text-zinc-600 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      {showAddButton && (
        <div className="relative" ref={containerRef}>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(v => !v)}>
            <Plus className="h-4 w-4 mr-2" />
            Add {ctName || 'entry'}
          </Button>
          {open && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-zinc-200 rounded-lg shadow-lg z-20 overflow-hidden">
              <div className="p-2 border-b border-zinc-100">
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full px-2 py-1.5 text-sm rounded border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="max-h-56 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="p-3 text-sm text-zinc-400">
                    {available.length === 0 ? 'No entries available' : 'No matches'}
                  </p>
                ) : (
                  filtered.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => add(opt.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 text-left transition-colors"
                    >
                      <span className="flex-1 text-sm text-zinc-900 truncate">{opt.label}</span>
                      <StatusPill status={opt.status} />
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
