import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { contentTypesApi, ContentType, FieldInput } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Plus, GripVertical, Trash2, Loader2, ChevronLeft, X } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/lib/settings';
import { slugify, slugifyUnderscore } from '@/lib/utils';

type FieldDraft = FieldInput & {
  _key: string;
  rich_text_extensions_draft: string[] | null; // null = all enabled
  select_options_draft: string[]; // list of option strings
};

const ALL_RICH_TEXT_EXTENSIONS = [
  { key: 'bold',          label: 'Bold' },
  { key: 'italic',        label: 'Italic' },
  { key: 'strike',        label: 'Strikethrough' },
  { key: 'code',          label: 'Inline Code' },
  { key: 'heading',       label: 'Headings' },
  { key: 'blockquote',    label: 'Blockquote' },
  { key: 'codeBlock',     label: 'Code Block' },
  { key: 'horizontalRule',label: 'Divider' },
  { key: 'bulletList',    label: 'Bullet List' },
  { key: 'orderedList',   label: 'Numbered List' },
  { key: 'link',          label: 'Links' },
  { key: 'image',         label: 'Images' },
] as const;

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'rich_text', label: 'Rich Text' },
  { value: 'image', label: 'Image' },
  { value: 'number', label: 'Number' },
  { value: 'datetime', label: 'Date & Time' },
  { value: 'boolean', label: 'Checkbox' },
  { value: 'relation', label: 'Link to' },
  { value: 'select', label: 'Select' },
];

export default function ContentTypeForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [name, setName] = useState('');
  usePageTitle(isNew ? 'New Collection' : name);
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [fields, setFields] = useState<FieldDraft[]>([]);
  const [allContentTypes, setAllContentTypes] = useState<ContentType[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!isNew);

  // Auto-slug from name if slug hasn't been manually edited
  const [slugManual, setSlugManual] = useState(false);
  useEffect(() => {
    if (!slugManual) setSlug(slugify(name));
  }, [name, slugManual]);

  useEffect(() => {
    contentTypesApi.list().then(setAllContentTypes).catch(() => {});
    if (!isNew && id) {
      contentTypesApi.get(id)
        .then(ct => {
          setName(ct.name);
          setSlug(ct.slug);
          setDescription(ct.description ?? '');
          setPreviewUrl(ct.preview_url ?? '');
          setSlugManual(true);
          setFields((ct.fields ?? []).map((f, i) => ({
            ...f,
            required: f.required === 1,
            multiple: f.multiple === 1,
            rich_text_extensions_draft: f.rich_text_extensions
              ? JSON.parse(f.rich_text_extensions) as string[]
              : null,
            select_options_draft: f.select_options
              ? JSON.parse(f.select_options) as string[]
              : [],
            _key: `field_${i}`,
          })));
        })
        .catch(() => toast.error('Failed to load content type'))
        .finally(() => setLoading(false));
    }
  }, [id, isNew]);

  const addField = () => {
    setFields(prev => [
      ...prev,
      {
        _key: `field_${Date.now()}`,
        name: '',
        type: 'text',
        required: false,
        sort_order: prev.length,
        relation_content_type_id: null,
        relation_cardinality: 'one',
        rich_text_extensions_draft: null,
        select_options_draft: [],
        min_length: null,
        max_length: null,
        min_value: null,
        max_value: null,
        pattern: null,
      },
    ]);
  };

  const updateField = (key: string, updates: Partial<FieldDraft>) => {
    setFields(prev => prev.map(f => f._key === key ? { ...f, ...updates } : f));
  };

  const removeField = (key: string) => {
    setFields(prev => prev.filter(f => f._key !== key));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('Name is required');

    setSaving(true);
    const fieldData = fields.map((f, i) => ({
      id: (f as FieldInput & { id?: string }).id,
      name: f.name,
      slug: f.slug || slugifyUnderscore(f.name),
      type: f.type,
      required: !!f.required,
      multiple: !!f.multiple,
      sort_order: i,
      relation_content_type_id: f.relation_content_type_id ?? null,
      relation_cardinality: f.relation_cardinality ?? null,
      rich_text_extensions: f.rich_text_extensions_draft
        ? JSON.stringify(f.rich_text_extensions_draft)
        : null,
      select_options: f.select_options_draft.length
        ? JSON.stringify(f.select_options_draft)
        : null,
      min_length: f.min_length ?? null,
      max_length: f.max_length ?? null,
      min_value: f.min_value ?? null,
      max_value: f.max_value ?? null,
      pattern: f.pattern ?? null,
    }));

    try {
      if (isNew) {
        const ct = await contentTypesApi.create({ name, slug, description, preview_url: previewUrl || null, fields: fieldData });
        toast.success('Created!');
        navigate(`/content-types/${ct.id}`);
      } else {
        await contentTypesApi.update(id!, { name, slug, description, preview_url: previewUrl || null, fields: fieldData });
        toast.success('Saved!');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/content-types">
          <Button variant="ghost" size="icon">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">
            {isNew ? 'New Collection' : `Edit: ${name}`}
          </h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic info */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
          <h2 className="font-semibold text-zinc-800">Basic Info</h2>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Blog Post" required />
          </div>
          <div className="space-y-1.5">
            <Label>Slug</Label>
            <Input
              value={slug}
              onChange={e => { setSlug(e.target.value); setSlugManual(true); }}
              placeholder="blog-post"
              className="font-mono text-sm"
            />
            <p className="text-xs text-zinc-400">Used in API: /api/public/{slug || 'slug'}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Preview URL</Label>
            <Input
              value={previewUrl}
              onChange={e => setPreviewUrl(e.target.value)}
              placeholder="https://my-site.com/blog/:slug?preview=:token"
              className="font-mono text-sm"
            />
            <p className="text-xs text-zinc-400"><code className="bg-zinc-100 px-1 rounded">:slug</code> → entry slug or ID · <code className="bg-zinc-100 px-1 rounded">:token</code> → preview JWT</p>
          </div>
        </div>

        {/* Fields */}
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-zinc-800">Fields</h2>
            <Button type="button" variant="outline" size="sm" onClick={addField}>
              <Plus className="h-4 w-4 mr-1" />
              Add Field
            </Button>
          </div>

          {fields.length === 0 ? (
            <div className="text-center py-8 text-zinc-400 text-sm border-2 border-dashed border-zinc-100 rounded-lg">
              No fields yet. Add a field to define your content structure.
            </div>
          ) : (
            <div className="space-y-3">
              {fields.map((field, _i) => (
                <div key={field._key} className="border border-zinc-200 rounded-lg p-4 space-y-3 bg-zinc-50">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-zinc-300 shrink-0" />
                    <div className="flex-1 grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Field Name</Label>
                        <Input
                          value={field.name}
                          onChange={e => updateField(field._key, { name: e.target.value })}
                          placeholder="Title"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Type</Label>
                        <Select
                          value={field.type}
                          onValueChange={v => updateField(field._key, { type: v })}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FIELD_TYPES.map(t => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeField(field._key)}
                      className="p-1 text-zinc-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-4 ml-6">
                    <div className="flex items-center gap-2 mt-4">
                      <Switch
                        checked={!!field.required}
                        onCheckedChange={v => updateField(field._key, { required: v })}
                      />
                      <Label className="text-xs">Required</Label>
                    </div>
                    {(field.type === 'image' || field.type === 'select') && (
                      <div className="flex items-center gap-2 mt-4">
                        <Switch
                          checked={!!field.multiple}
                          onCheckedChange={v => updateField(field._key, { multiple: v })}
                        />
                        <Label className="text-xs">
                          {field.type === 'image' ? 'Multiple images' : 'Allow multiple'}
                        </Label>
                      </div>
                    )}
                  </div>

                  {/* Rich text extension picker */}
                  {field.type === 'rich_text' && (
                    <div className="ml-6 space-y-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={field.rich_text_extensions_draft !== null}
                          onCheckedChange={v =>
                            updateField(field._key, {
                              rich_text_extensions_draft: v
                                ? ALL_RICH_TEXT_EXTENSIONS.map(e => e.key)
                                : null,
                            })
                          }
                        />
                        <Label className="text-xs">Restrict formatting options</Label>
                      </div>
                      {field.rich_text_extensions_draft !== null && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
                          {ALL_RICH_TEXT_EXTENSIONS.map(ext => {
                            const checked = field.rich_text_extensions_draft?.includes(ext.key) ?? false;
                            return (
                              <label key={ext.key} className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={e => {
                                    const current = field.rich_text_extensions_draft ?? [];
                                    const next = e.target.checked
                                      ? [...current, ext.key]
                                      : current.filter(k => k !== ext.key);
                                    updateField(field._key, { rich_text_extensions_draft: next });
                                  }}
                                  className="rounded border-zinc-300"
                                />
                                <span className="text-xs text-zinc-600">{ext.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Select options */}
                  {field.type === 'select' && (
                    <div className="ml-6 space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Options</Label>
                        <button
                          type="button"
                          onClick={() => updateField(field._key, {
                            select_options_draft: [...field.select_options_draft, ''],
                          })}
                          className="text-xs text-indigo-600 hover:text-indigo-800"
                        >
                          + Add option
                        </button>
                      </div>
                      {field.select_options_draft.length === 0 ? (
                        <p className="text-xs text-zinc-400">No options yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {field.select_options_draft.map((opt, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <Input
                                value={opt}
                                onChange={e => {
                                  const next = [...field.select_options_draft];
                                  next[i] = e.target.value;
                                  updateField(field._key, { select_options_draft: next });
                                }}
                                placeholder="Option label"
                                className="h-7 text-xs flex-1"
                              />
                              <button
                                type="button"
                                onClick={() => updateField(field._key, {
                                  select_options_draft: field.select_options_draft.filter((_, j) => j !== i),
                                })}
                                className="text-zinc-400 hover:text-red-500"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Validation rules */}
                  {(field.type === 'text' || field.type === 'rich_text') && (
                    <div className="ml-6 grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Min length</Label>
                        <Input
                          type="number"
                          min={0}
                          value={field.min_length ?? ''}
                          onChange={e => updateField(field._key, { min_length: e.target.value ? Number(e.target.value) : null })}
                          placeholder="—"
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Max length</Label>
                        <Input
                          type="number"
                          min={0}
                          value={field.max_length ?? ''}
                          onChange={e => updateField(field._key, { max_length: e.target.value ? Number(e.target.value) : null })}
                          placeholder="—"
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Pattern (regex)</Label>
                        <Input
                          value={field.pattern ?? ''}
                          onChange={e => updateField(field._key, { pattern: e.target.value || null })}
                          placeholder="—"
                          className="h-7 text-xs font-mono"
                        />
                      </div>
                    </div>
                  )}
                  {field.type === 'number' && (
                    <div className="ml-6 grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Min value</Label>
                        <Input
                          type="number"
                          value={field.min_value ?? ''}
                          onChange={e => updateField(field._key, { min_value: e.target.value ? Number(e.target.value) : null })}
                          placeholder="—"
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Max value</Label>
                        <Input
                          type="number"
                          value={field.max_value ?? ''}
                          onChange={e => updateField(field._key, { max_value: e.target.value ? Number(e.target.value) : null })}
                          placeholder="—"
                          className="h-7 text-xs"
                        />
                      </div>
                    </div>
                  )}

                  {/* Relation config */}
                  {field.type === 'relation' && (
                    <div className="ml-6 grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Collection</Label>
                        <Select
                          value={field.relation_content_type_id ?? ''}
                          onValueChange={v => updateField(field._key, { relation_content_type_id: v || null })}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Select collection..." />
                          </SelectTrigger>
                          <SelectContent>
                            {allContentTypes.map(ct => (
                              <SelectItem key={ct.id} value={ct.id}>{ct.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">How many</Label>
                        <Select
                          value={field.relation_cardinality ?? 'one'}
                          onValueChange={v => updateField(field._key, { relation_cardinality: v as 'one' | 'many' })}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="one">One item</SelectItem>
                            <SelectItem value="many">Multiple items</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {/* API key */}
                  <div className="ml-6 space-y-1">
                    <Label className="text-xs">API key</Label>
                    <Input
                      value={field.slug ?? slugifyUnderscore(field.name)}
                      onChange={e => updateField(field._key, { slug: e.target.value })}
                      placeholder={slugifyUnderscore(field.name) || 'field_key'}
                      className="h-7 text-xs font-mono w-36"
                    />
                    <p className="text-xs text-zinc-400">Used as the key in the API response.</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Link to="/content-types">
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isNew ? 'Create' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}
