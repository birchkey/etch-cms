import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { Field, RepeaterSubfield, contentTypesApi, assetsApi } from '@/lib/api';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { RichTextEditor } from './RichTextEditor';
import { AssetPicker } from './AssetPicker';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Image as ImageIcon, X, Plus, ExternalLink, FileText, Film, File, GripVertical } from 'lucide-react';

function assetTypeFromUrl(url: string): 'image' | 'video' | 'pdf' | 'file' {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  return 'file';
}

function filenameFromUrl(url: string): string {
  return decodeURIComponent(url.split('?')[0].split('/').pop() ?? url);
}

// Module-level cache so repeated renders don't re-fetch
const assetNameCache = new Map<string, string>();

function useAssetName(url: string | null): string | null {
  const [name, setName] = useState<string | null>(() => (url ? assetNameCache.get(url) ?? null : null));
  useEffect(() => {
    if (!url || assetNameCache.has(url)) return;
    const filename = filenameFromUrl(url);
    assetsApi.list({ filename, limit: 1 })
      .then(res => {
        const originalName = res.data[0]?.original_name ?? null;
        if (originalName) {
          assetNameCache.set(url, originalName);
          setName(originalName);
        }
      })
      .catch(() => {});
  }, [url]);
  return name;
}

function AssetThumbnail({ url, name, className }: { url: string; name?: string | null; className?: string }) {
  const type = assetTypeFromUrl(url);
  if (type === 'image') {
    return <img src={url} alt="" className={className} />;
  }
  const Icon = type === 'video' ? Film : type === 'pdf' ? FileText : File;
  const label = type === 'video' ? 'Video' : type === 'pdf' ? 'PDF' : 'File';
  const displayName = name ?? filenameFromUrl(url);
  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 bg-zinc-50 text-zinc-400 ${className ?? ''}`}>
      <Icon className="h-8 w-8" />
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <span className="text-[10px] text-zinc-400 text-center px-2 line-clamp-2 break-all">{displayName}</span>
    </div>
  );
}

const ALL_TIMEZONES: readonly string[] =
  typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
    ? (Intl as { supportedValuesOf(key: string): string[] }).supportedValuesOf('timeZone')
    : [];

function parseDatetimeValue(value: unknown): { datetime: string; timezone: string } {
  const defaultTz =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  if (!value) return { datetime: '', timezone: defaultTz };
  if (typeof value === 'string') return { datetime: value, timezone: defaultTz };
  if (typeof value === 'object' && value !== null) {
    const v = value as { datetime?: string; timezone?: string };
    return { datetime: v.datetime ?? '', timezone: v.timezone ?? defaultTz };
  }
  return { datetime: '', timezone: defaultTz };
}

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

    case 'email':
      return (
        <Input
          type="email"
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder="name@example.com"
        />
      );

    case 'phone':
      return (
        field.phone_format === 'international'
          ? <PhoneInputInternational value={(value as string) ?? ''} onChange={onChange} />
          : <PhoneInputUS value={(value as string) ?? ''} onChange={onChange} />
      );

    case 'color':
      return <ColorInput value={(value as string) ?? ''} onChange={onChange} />;

    case 'number':
      return (
        <Input
          type="number"
          value={(value as number) ?? ''}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder="0"
        />
      );

    case 'datetime': {
      const dtParsed = parseDatetimeValue(value);
      const tzListId = `tz-${field.id}`;
      return (
        <div className="space-y-2">
          <Input
            type="datetime-local"
            value={dtParsed.datetime}
            onChange={e => onChange({ datetime: e.target.value, timezone: dtParsed.timezone })}
          />
          <div className="space-y-1">
            <Label className="text-xs text-zinc-500">Time zone</Label>
            <Input
              list={tzListId}
              value={dtParsed.timezone}
              onChange={e => onChange({ datetime: dtParsed.datetime, timezone: e.target.value })}
              placeholder="e.g. America/Chicago"
              className="font-mono text-sm"
            />
            <datalist id={tzListId}>
              {ALL_TIMEZONES.map(tz => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </div>
        </div>
      );
    }

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

    case 'repeater':
      return (
        <RepeaterFieldEditor
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

function formatUS(digits: string): string {
  digits = digits.slice(0, 10);
  if (digits.length >= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length >= 3) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  if (digits.length > 0) return `(${digits}`;
  return '';
}

function PhoneInputUS({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const allowed = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (allowed.includes(e.key)) return;
    if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase())) return;
    if (!/\d/.test(e.key)) e.preventDefault();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const prevDigits = (value ?? '').replace(/\D/g, '');
    const rawDigits = e.target.value.replace(/\D/g, '');
    let digits = rawDigits.slice(0, 10);
    // Digit count unchanged but string shrank → backspace hit a separator, remove one digit
    if (rawDigits.length === prevDigits.length && prevDigits.length > 0 && rawDigits.length <= 10) {
      digits = digits.slice(0, -1);
    }
    const formatted = formatUS(digits);
    onChange(formatted);
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(formatted.length, formatted.length);
    });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 10);
    onChange(formatUS(digits));
  };

  return (
    <Input
      ref={inputRef}
      type="tel"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder="(555) 000-0000"
      inputMode="numeric"
    />
  );
}

function PhoneInputInternational({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    if (!raw) return;
    const parsed = parsePhoneNumberFromString(raw);
    if (parsed?.isValid()) onChange(parsed.formatInternational());
  }, [onChange]);

  return (
    <Input
      type="tel"
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={handleBlur}
      placeholder="+1 555 000 0000"
    />
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  const colorRef = useRef<HTMLInputElement>(null);
  const isValid = /^#[0-9A-Fa-f]{6}$/.test(value);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => colorRef.current?.click()}
        className="h-9 w-9 rounded-md border border-zinc-200 shrink-0 hover:opacity-80 transition-opacity"
        style={{ backgroundColor: isValid ? value : '#e4e4e7' }}
        title="Pick color"
      />
      <input
        ref={colorRef}
        type="color"
        value={isValid ? value : '#000000'}
        onChange={e => onChange(e.target.value)}
        className="sr-only"
      />
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="#000000"
        className="w-32 font-mono"
        maxLength={7}
      />
    </div>
  );
}

function ImageFieldEditor({ value, onChange }: { value: string | null; onChange: (v: unknown) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const isImage = value ? assetTypeFromUrl(value) === 'image' : false;
  const assetName = useAssetName(!isImage ? value : null);

  return (
    <div className="space-y-3">
      {value ? (
        <div className="inline-flex flex-col items-start gap-2">
          <div className="relative">
            {isImage ? (
              <img src={value} alt="Selected" className="max-h-48 rounded-md border border-zinc-200" />
            ) : (
              <div className="w-48 h-36 rounded-md border border-zinc-200 overflow-hidden">
                <AssetThumbnail url={value} name={assetName} className="w-full h-full" />
              </div>
            )}
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute -top-2 -right-2 bg-white rounded-full border border-zinc-200 p-0.5 hover:bg-zinc-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              Change asset
            </Button>
            {!isImage && (
              <a
                href={value}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-zinc-500 hover:text-zinc-700 underline underline-offset-2"
              >
                Open file
              </a>
            )}
          </div>
        </div>
      ) : (
        <div
          onClick={() => setPickerOpen(true)}
          className="border-2 border-dashed border-zinc-200 rounded-md p-8 flex flex-col items-center gap-2 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
        >
          <ImageIcon className="h-8 w-8 text-zinc-300" />
          <span className="text-sm text-zinc-500">Click to select asset</span>
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

function AssetThumbnailWithName({ url }: { url: string }) {
  const isImage = assetTypeFromUrl(url) === 'image';
  const name = useAssetName(!isImage ? url : null);
  return <AssetThumbnail url={url} name={name} className={isImage ? 'w-full h-full object-cover' : 'w-full h-full'} />;
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
              <div className="h-32 w-32 rounded-md border border-zinc-200 overflow-hidden">
                <AssetThumbnailWithName url={url} />
              </div>
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
        {images.length === 0 ? 'Add asset' : 'Add another asset'}
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
  const [loading, setLoading] = useState(!!field.relation_content_type_id);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!field.relation_content_type_id) return;
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

type RepeaterItem = Record<string, unknown> & { _id: string };

function RepeaterFieldEditor({ field, value, onChange }: FieldValueEditorProps) {
  const subfields = useMemo<RepeaterSubfield[]>(() => {
    if (!field.repeater_subfields) return [];
    try { return JSON.parse(field.repeater_subfields) as RepeaterSubfield[]; } catch { return []; }
  }, [field.repeater_subfields]);

  const items = ((value as RepeaterItem[] | null) ?? []);

  const sensors = useSensors(useSensor(PointerSensor));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex(i => i._id === active.id);
      const newIndex = items.findIndex(i => i._id === over.id);
      onChange(arrayMove([...items], oldIndex, newIndex));
    }
  };

  const addItem = () => {
    const newItem: RepeaterItem = { _id: crypto.randomUUID() };
    for (const sf of subfields) newItem[sf.slug] = null;
    onChange([...items, newItem]);
  };

  const removeItem = (id: string) => {
    onChange(items.filter(item => item._id !== id));
  };

  const updateItem = (id: string, slug: string, val: unknown) => {
    onChange(items.map(item => item._id === id ? { ...item, [slug]: val } : item));
  };

  if (subfields.length === 0) {
    return <p className="text-sm text-zinc-400">No sub-fields defined. Edit this collection's schema to configure the repeater.</p>;
  }

  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map(i => i._id)} strategy={verticalListSortingStrategy}>
          {items.map((item, index) => (
            <RepeaterItemCard
              key={item._id}
              id={item._id}
              index={index}
              item={item}
              subfields={subfields}
              onUpdate={(slug, val) => updateItem(item._id, slug, val)}
              onRemove={() => removeItem(item._id)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <Button type="button" variant="outline" size="sm" onClick={addItem}>
        <Plus className="h-4 w-4 mr-2" />
        Add item
      </Button>
    </div>
  );
}

function RepeaterItemCard({
  id,
  index,
  item,
  subfields,
  onUpdate,
  onRemove,
}: {
  id: string;
  index: number;
  item: RepeaterItem;
  subfields: RepeaterSubfield[];
  onUpdate: (slug: string, val: unknown) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="border border-zinc-200 rounded-lg bg-white">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-100 bg-zinc-50 rounded-t-lg">
        <button type="button" {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing touch-none p-0.5 text-zinc-300 hover:text-zinc-500">
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="flex-1 text-sm font-medium text-zinc-600">Item {index + 1}</span>
        <button type="button" onClick={onRemove} className="p-1 text-zinc-400 hover:text-red-500 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-4 space-y-4">
        {subfields.map(sf => {
          const fakeField: Field = {
            id: sf.id,
            content_type_id: '',
            name: sf.name,
            slug: sf.slug,
            type: sf.type as Field['type'],
            required: sf.required ? 1 : 0,
            sort_order: 0,
            relation_content_type_id: null,
            relation_cardinality: null,
            multiple: sf.multiple ? 1 : 0,
            rich_text_extensions: sf.rich_text_extensions ?? null,
            select_options: sf.select_options ?? null,
            min_length: null,
            max_length: null,
            min_value: null,
            max_value: null,
            pattern: null,
            phone_format: sf.phone_format ?? null,
            repeater_subfields: null,
            created_at: 0,
          };
          return (
            <div key={sf.id} className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700">
                {sf.name}
                {sf.required && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              <FieldValueEditor
                field={fakeField}
                value={item[sf.slug] ?? null}
                onChange={val => onUpdate(sf.slug, val)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
