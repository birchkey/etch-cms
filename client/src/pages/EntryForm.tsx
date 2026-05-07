import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { contentTypesApi, entriesApi, ContentType, Entry, Field, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { StatusBadge } from '@/components/StatusBadge';
import { FieldValueEditor } from '@/components/FieldValueEditor';
import { ChevronLeft, Loader2, Globe, EyeOff, Save, AlertCircle, Copy, Link2, Clock, X, MoreHorizontal, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { slugify } from '@/lib/utils';
import { usePageTitle } from '@/lib/settings';

export default function EntryForm() {
  const { typeId, entryId } = useParams<{ typeId: string; entryId: string }>();
  const navigate = useNavigate();
  const isNew = !entryId || entryId === 'new';

  const [contentType, setContentType] = useState<ContentType | null>(null);
  usePageTitle(contentType ? (isNew ? `New ${contentType.name}` : `Edit ${contentType.name}`) : '');
  const [entry, setEntry] = useState<Entry | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const slugRef = useRef('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copyingPreview, setCopyingPreview] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSaveRef = useRef<() => void>(() => {});
  const handlePublishRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!typeId) return;
    const loadData = async () => {
      const ct = await contentTypesApi.get(typeId);
      setContentType(ct);

      if (!isNew && entryId) {
        const e = await entriesApi.get(entryId);
        setEntry(e);
        setFieldValues(e.fields);
        if (e.slug) {
          setSlug(e.slug);
          slugRef.current = e.slug;
          setSlugManual(true);
        }
      }
    };
    loadData()
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  }, [typeId, entryId, isNew]);

  useEffect(() => { slugRef.current = slug; }, [slug]);

  const updateField = useCallback((fieldSlug: string, value: unknown) => {
    setFieldValues(prev => {
      const next = { ...prev, [fieldSlug]: value };
      // Re-validate this field in real-time
      const field = contentType?.fields?.find(f => f.slug === fieldSlug);
      if (field) {
        const err = validateField(field, value);
        setFieldErrors(prev => {
          const next = { ...prev };
          if (err) next[fieldSlug] = err;
          else delete next[fieldSlug];
          return next;
        });
      }

      if (!slugManual && typeof value === 'string') {
        const firstTextField = contentType?.fields?.find(f => f.type === 'text');
        if (firstTextField && fieldSlug === firstTextField.slug) {
          const suggested = slugify(value);
          setSlug(suggested);
          slugRef.current = suggested;
        }
      }

      if (!isNew && entry) {
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        setAutoSaveStatus('saving');
        autoSaveTimer.current = setTimeout(async () => {
          try {
            const updated = await entriesApi.update(entry.id, { slug: slugRef.current || null, fields: next });
            setEntry(updated); // picks up has_unpublished_changes from server
            setAutoSaveStatus('saved');
            setTimeout(() => setAutoSaveStatus('idle'), 2000);
          } catch (err) {
            setAutoSaveStatus('error');
            toast.error('Auto-save failed', { description: err instanceof Error ? err.message : 'Unknown error' });
          }
        }, 1000);
      }
      return next;
    });
  }, [isNew, entry, slugManual, contentType]);

  const validateField = (field: Field, value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null;
    if (field.type === 'text' || field.type === 'rich_text') {
      const str = field.type === 'rich_text'
        ? String(value).replace(/<[^>]+>/g, '')
        : String(value);
      if (field.min_length !== null && str.length < field.min_length)
        return `Must be at least ${field.min_length} character${field.min_length !== 1 ? 's' : ''}`;
      if (field.max_length !== null && str.length > field.max_length)
        return `Must be ${field.max_length} character${field.max_length !== 1 ? 's' : ''} or fewer`;
      if (field.pattern) {
        try { if (!new RegExp(field.pattern).test(str)) return 'Does not match the required format'; }
        catch { /* invalid regex */ }
      }
    }
    if (field.type === 'number') {
      const num = typeof value === 'number' ? value : Number(value);
      if (!isNaN(num)) {
        if (field.min_value !== null && num < field.min_value) return `Must be at least ${field.min_value}`;
        if (field.max_value !== null && num > field.max_value) return `Must be ${field.max_value} or less`;
      }
    }
    return null;
  };

  const validateAll = (values: Record<string, unknown>): Record<string, string> => {
    const errors: Record<string, string> = {};
    for (const field of contentType?.fields ?? []) {
      const val = values[field.slug] ?? null;
      if (field.required && (val === null || val === undefined || val === '')) {
        errors[field.slug] = 'Required';
        continue;
      }
      const err = validateField(field, val);
      if (err) errors[field.slug] = err;
    }
    return errors;
  };

  const handleSave = async () => {
    if (!typeId) return;
    setSaving(true);
    try {
      if (isNew) {
        const created = await entriesApi.create({ content_type_id: typeId, slug: slug || null, fields: fieldValues });
        toast.success('Created!');
        navigate(`/content-types/${typeId}/entries/${created.id}`, { replace: true });
      } else if (entry) {
        const updated = await entriesApi.update(entry.id, { slug: slug || null, fields: fieldValues });
        setEntry(updated);
        toast.success('Saved!');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!entry || !contentType) return;

    // Client-side validation
    const errors = validateAll(fieldValues);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      toast.error('Fix validation errors before publishing');
      return;
    }

    setPublishing(true);
    try {
      // Flush any pending auto-save before publishing
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
      await entriesApi.update(entry.id, { slug: slug || null, fields: fieldValues });
      const result = await entriesApi.publish(entry.id);
      setEntry(result);
      setFieldErrors({});
      toast.success(entry.status === 'draft' ? 'Published!' : 'Changes published!');
      result.warnings.forEach(w => toast.warning(w));
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        setFieldErrors(err.fieldErrors);
        toast.error('Fix validation errors before publishing');
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed');
      }
    } finally {
      setPublishing(false);
    }
  };

  const handleDuplicate = async () => {
    if (!entry) return;
    setDuplicating(true);
    try {
      const copy = await entriesApi.duplicate(entry.id);
      toast.success('Duplicated as draft');
      navigate(`/content-types/${typeId}/entries/${copy.id}`, { replace: false });
    } catch {
      toast.error('Duplicate failed');
    } finally {
      setDuplicating(false);
    }
  };

  const handleCopyPreviewLink = async () => {
    if (!entry) return;
    setCopyingPreview(true);
    try {
      const { token, url: apiUrl } = await entriesApi.previewToken(entry.id);
      let finalUrl = apiUrl;
      if (contentType?.preview_url) {
        const slugOrId = entry.slug || entry.id;
        finalUrl = contentType.preview_url
          .replace(/:slug/g, slugOrId)
          .replace(/:token/g, token);
      }
      await navigator.clipboard.writeText(finalUrl);
      toast.success('Preview link copied');
    } catch {
      toast.error('Failed to generate preview link');
    } finally {
      setCopyingPreview(false);
    }
  };

  const handleUnpublish = async () => {
    if (!entry) return;
    setPublishing(true);
    try {
      const updated = await entriesApi.unpublish(entry.id);
      setEntry(updated);
      toast.success('Unpublished');
    } catch {
      toast.error('Failed');
    } finally {
      setPublishing(false);
    }
  };

  const handleSchedule = async () => {
    if (!entry || !scheduleDate) return;
    setScheduling(true);
    try {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
      await entriesApi.update(entry.id, { slug: slug || null, fields: fieldValues });
      const updated = await entriesApi.schedule(entry.id, new Date(scheduleDate).getTime());
      setEntry(updated);
      setShowScheduler(false);
      setScheduleDate('');
      toast.success('Scheduled!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule');
    } finally {
      setScheduling(false);
    }
  };

  const handleUnschedule = async () => {
    if (!entry) return;
    setPublishing(true);
    try {
      const updated = await entriesApi.unschedule(entry.id);
      setEntry(updated);
      toast.success('Unscheduled');
    } catch {
      toast.error('Failed');
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async () => {
    if (!entry) return;
    setDeleting(true);
    try {
      await entriesApi.delete(entry.id);
      toast.success('Entry deleted');
      navigate(`/content-types/${typeId}/entries`, { replace: true });
    } catch {
      toast.error('Failed to delete entry');
      setDeleting(false);
    }
  };

  handleSaveRef.current = handleSave;
  handlePublishRef.current = handlePublish;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === 's') {
        e.preventDefault();
        handleSaveRef.current();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handlePublishRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;
  }

  const fields: Field[] = contentType?.fields ?? [];
  const hasUnpublishedChanges = !!entry?.has_unpublished_changes;
  const isPublished = entry?.status === 'published';
  const isScheduled = entry?.status === 'scheduled';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Sticky toolbar */}
      <div className="sticky top-0 z-30 bg-white border-b border-zinc-200 px-6 py-3 flex items-center gap-4">
        <Link to={`/content-types/${typeId}/entries`}>
          <Button variant="ghost" size="icon">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <p className="text-xs text-zinc-400">{contentType?.name}</p>
          <p className="text-sm font-semibold text-zinc-900">
            {isNew ? 'New Entry' : 'Edit Entry'}
          </p>
        </div>
        {!isNew && entry && (
          <div className="flex items-center gap-3">
            <StatusBadge status={entry.status} hasChanges={hasUnpublishedChanges} />
            {isScheduled && entry.scheduled_at && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5">
                <Clock className="h-3 w-3" />
                {new Date(entry.scheduled_at).toLocaleString()}
              </span>
            )}
            {autoSaveStatus === 'saving' && (
              <span className="text-xs text-zinc-400 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving...
              </span>
            )}
            {autoSaveStatus === 'saved' && (
              <span className="text-xs text-green-600">Saved</span>
            )}
            {autoSaveStatus === 'error' && (
              <span className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> Save failed
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          {!isNew && entry && (
            <>
              <Button variant="outline" size="sm" onClick={handleCopyPreviewLink} disabled={copyingPreview}>
                {copyingPreview ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Link2 className="h-4 w-4 mr-2" />}
                Preview Link
              </Button>
              {isPublished && hasUnpublishedChanges && (
                <Button size="sm" onClick={handlePublish} disabled={publishing}>
                  {publishing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Globe className="h-4 w-4 mr-2" />}
                  Publish Changes
                </Button>
              )}
              {isScheduled && (
                <Button size="sm" onClick={handlePublish} disabled={publishing}>
                  {publishing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Globe className="h-4 w-4 mr-2" />}
                  Publish Now
                </Button>
              )}
              {!isPublished && !isScheduled && (
                <>
                  {showScheduler ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="datetime-local"
                        value={scheduleDate}
                        onChange={e => setScheduleDate(e.target.value)}
                        className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                      />
                      <Button size="sm" onClick={handleSchedule} disabled={scheduling || !scheduleDate}>
                        {scheduling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Clock className="h-4 w-4 mr-2" />}
                        Confirm
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => { setShowScheduler(false); setScheduleDate(''); }}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setShowScheduler(true)}>
                      <Clock className="h-4 w-4 mr-2" />
                      Schedule
                    </Button>
                  )}
                  <Button size="sm" onClick={handlePublish} disabled={publishing}>
                    {publishing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Globe className="h-4 w-4 mr-2" />}
                    Publish
                  </Button>
                </>
              )}
            </>
          )}
          <Button variant={isNew ? 'default' : 'outline'} size="sm" onClick={handleSave} disabled={saving}>
            {saving
              ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
              : <Save className="h-4 w-4 mr-2" />
            }
            {isNew ? 'Create' : 'Save'}
          </Button>
          {!isNew && entry && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isPublished && (
                  <DropdownMenuItem onClick={handleUnpublish} disabled={publishing}>
                    <EyeOff className="h-4 w-4 mr-2" />
                    Unpublish
                  </DropdownMenuItem>
                )}
                {isScheduled && (
                  <DropdownMenuItem onClick={handleUnschedule} disabled={publishing}>
                    <X className="h-4 w-4 mr-2" />
                    Unschedule
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleDuplicate} disabled={duplicating}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowDeleteConfirm(true)} className="text-red-600 focus:text-red-600">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-8 max-w-3xl mx-auto w-full">
        {fields.length === 0 ? (
          <div className="text-center py-20 text-zinc-400">
            <p>This content type has no fields.</p>
            <Link
              to={`/content-types/${typeId}`}
              className="text-indigo-600 hover:underline text-sm mt-2 inline-block"
            >
              Add fields to this content type
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Slug */}
            <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-zinc-800">Page URL</Label>
                <span className="text-xs text-zinc-400 font-mono">optional</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-400 shrink-0">/</span>
                <Input
                  value={slug}
                  onChange={e => {
                    setSlug(e.target.value);
                    slugRef.current = e.target.value;
                    setSlugManual(true);
                  }}
                  onBlur={() => {
                    const clean = slugify(slug);
                    setSlug(clean);
                    slugRef.current = clean;
                  }}
                  placeholder="my-entry-title"
                  className="font-mono text-sm"
                />
              </div>
              <p className="text-xs text-zinc-400">
                The URL-friendly identifier for this entry. Auto-generated from the title — leave blank to use a default.
              </p>
            </div>

            {fields.map(field => {
              const fieldError = fieldErrors[field.slug];
              const rawVal = fieldValues[field.slug] ?? null;
              const charCount = (field.type === 'text' || field.type === 'rich_text') && (field.min_length || field.max_length)
                ? (field.type === 'rich_text'
                    ? String(rawVal ?? '').replace(/<[^>]+>/g, '').length
                    : String(rawVal ?? '').length)
                : null;
              return (
                <div key={field.id} className={`bg-white rounded-xl border p-5 space-y-2 ${fieldError ? 'border-red-300' : 'border-zinc-200'}`}>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-zinc-800">
                      {field.name}
                      {field.required === 1 && <span className="text-red-400 ml-1">*</span>}
                    </Label>
                    {charCount !== null && (
                      <span className={`text-xs font-mono ${field.max_length && charCount > field.max_length ? 'text-red-500' : 'text-zinc-400'}`}>
                        {charCount}{field.max_length ? `/${field.max_length}` : ''}
                      </span>
                    )}
                  </div>
                  <FieldValueEditor
                    field={field}
                    value={rawVal}
                    onChange={value => updateField(field.slug, value)}
                  />
                  {fieldError && (
                    <p className="text-xs text-red-500 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />{fieldError}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isNew && entry && (
          <div className="mt-6 pt-6 border-t border-zinc-100 text-xs text-zinc-400 space-y-1">
            <p>Created: {new Date(entry.created_at).toLocaleString()}</p>
            <p>Updated: {new Date(entry.updated_at).toLocaleString()}</p>
            {entry.published_at && <p>Published: {new Date(entry.published_at).toLocaleString()}</p>}
            <p className="font-mono">ID: {entry.id}</p>
          </div>
        )}
      </div>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete entry?</DialogTitle>
            <DialogDescription>
              This will permanently delete this entry and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
