import { useEffect, useState } from 'react';
import { auditLogApi, AuditLog, PaginatedResponse } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { usePageTitle } from '@/lib/settings';

const ACTION_LABELS: Record<string, string> = {
  'entry.create': 'Created entry',
  'entry.update': 'Updated entry',
  'entry.publish': 'Published entry',
  'entry.unpublish': 'Unpublished entry',
  'entry.schedule': 'Scheduled entry',
  'entry.unschedule': 'Unscheduled entry',
  'entry.delete': 'Deleted entry',
  'entry.duplicate': 'Duplicated entry',
  'content_type.create': 'Created content type',
  'content_type.update': 'Updated content type',
  'content_type.delete': 'Deleted content type',
  'asset.upload': 'Uploaded asset',
  'asset.delete': 'Deleted asset',
};

const FILTER_TABS: [string, string][] = [
  ['', 'All'],
  ['entry', 'Entries'],
  ['content_type', 'Content Types'],
  ['asset', 'Assets'],
];

function formatVal(val: unknown): string {
  if (val === null || val === undefined) return 'empty';
  if (typeof val === 'string') {
    const s = val.replace(/<[^>]+>/g, '');
    return `"${s.length > 40 ? s.slice(0, 40) + '…' : s}"`;
  }
  return String(val);
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  usePageTitle('Activity');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [meta, setMeta] = useState<PaginatedResponse<AuditLog>['meta'] | null>(null);
  const [page, setPage] = useState(1);
  const [resourceType, setResourceType] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    auditLogApi.list({ page, limit: PAGE_SIZE, resource_type: resourceType || undefined })
      .then(res => {
        setLogs(res.data);
        setMeta(res.meta);
      })
      .catch(() => toast.error('Failed to load audit log'))
      .finally(() => setLoading(false));
  }, [page, resourceType]);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Admin</p>
        <h1 className="text-2xl font-bold text-zinc-900">Activity</h1>
        <p className="text-sm text-zinc-500 mt-1">A record of all content changes made by your team.</p>
      </div>

      <div className="flex rounded-lg border border-zinc-200 overflow-hidden text-sm bg-white w-fit mb-4">
        {FILTER_TABS.map(([val, label]) => (
          <button
            key={val}
            onClick={() => { setLoading(true); setResourceType(val); setPage(1); }}
            className={`px-3 py-1.5 transition-colors ${resourceType === val ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-zinc-200">
          <p className="text-zinc-500 text-sm">No activity recorded yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
          {logs.map(log => (
            <div key={log.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold shrink-0">
                {(log.actor_name ?? log.actor_id)[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-900 truncate">
                  <span className="font-medium">{log.actor_name ?? log.actor_id}</span>
                  {' '}
                  <span className="text-zinc-500">{ACTION_LABELS[log.action] ?? log.action}</span>
                  {log.resource_label && (
                    <> <span className="font-medium text-zinc-700">"{log.resource_label}"</span></>
                  )}
                </p>
                {(() => {
                  if (log.action !== 'entry.update' || !log.details) return null;
                  try {
                    const details = JSON.parse(log.details) as { changes?: { field: string; from?: unknown; to?: unknown }[] };
                    const changes = details.changes;
                    if (!changes?.length) return null;
                    return (
                      <p className="text-xs text-zinc-400 mt-0.5 truncate">
                        {changes.map(ch =>
                          ch.from === undefined && ch.to === undefined
                            ? `${ch.field} (rich text)`
                            : `${ch.field}: ${formatVal(ch.from)} → ${formatVal(ch.to)}`
                        ).join(' · ')}
                      </p>
                    );
                  } catch { return null; }
                })()}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                log.actor_role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-zinc-100 text-zinc-600'
              }`}>
                {log.actor_role}
              </span>
              <span
                className="text-xs text-zinc-400 shrink-0 tabular-nums"
                title={new Date(log.created_at).toLocaleString()}
              >
                {timeAgo(log.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}

      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { setLoading(true); setPage(p => p - 1); }}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-zinc-500">Page {page} of {meta.pages}</span>
          <Button variant="outline" size="sm" disabled={!meta.has_next} onClick={() => { setLoading(true); setPage(p => p + 1); }}>
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {!loading && meta && (
        <p className="text-xs text-zinc-400 text-center mt-4">
          {meta.total} event{meta.total !== 1 ? 's' : ''} total
        </p>
      )}
    </div>
  );
}
