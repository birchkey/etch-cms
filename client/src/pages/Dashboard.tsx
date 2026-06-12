import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { contentTypesApi, ContentType, assetsApi, entriesApi, AttentionItem, RecentEntry, UpcomingEntry } from '@/lib/api';
import { FileText, Image, Database, ArrowRight, Plus, Pencil } from 'lucide-react';
import { usePageTitle } from '@/lib/settings';
import { StatusBadge } from '@/components/StatusBadge';

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function timeUntil(ms: number): string {
  const diff = ms - Date.now();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export default function Dashboard() {
  usePageTitle('Dashboard');
  const [contentTypes, setContentTypes] = useState<ContentType[]>([]);
  const [entryCount, setEntryCount] = useState(0);
  const [assetCount, setAssetCount] = useState(0);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingEntry[]>([]);

  useEffect(() => {
    contentTypesApi.list().then(setContentTypes).catch(() => {});
    entriesApi.count().then(r => setEntryCount(r.count)).catch(() => {});
    assetsApi.list({ limit: 1 }).then(res => setAssetCount(res.meta.total)).catch(() => {});
    entriesApi.attention().then(setAttention).catch(() => {});
    entriesApi.recent().then(setRecentEntries).catch(() => {});
    entriesApi.upcoming().then(setUpcoming).catch(() => {});
  }, []);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
        <p className="text-zinc-500 mt-1">Welcome to your CMS admin panel.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard
          icon={<Database className="h-5 w-5 text-indigo-600" />}
          label="Collections"
          value={contentTypes.length}
        />
        <StatCard
          icon={<FileText className="h-5 w-5 text-indigo-600" />}
          label="Entries"
          value={entryCount}
        />
        <StatCard
          icon={<Image className="h-5 w-5 text-indigo-600" />}
          label="Assets"
          value={assetCount}
        />
      </div>

      {/* Pending */}
      {attention.length > 0 && (
        <div className="mb-8">
          <h2 className="text-base font-semibold text-zinc-900 mb-4">Pending</h2>
          <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
            {attention.map(item => (
              <div key={item.content_type_id} className="flex items-center gap-4 px-5 py-3.5">
                <p className="text-sm font-medium text-zinc-900 flex-1">{item.content_type_name}</p>
                <div className="flex items-center gap-2">
                  {item.draft_count > 0 && (
                    <Link
                      to={`/content-types/${item.content_type_id}/entries?status=draft`}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-colors"
                    >
                      {item.draft_count} draft{item.draft_count !== 1 ? 's' : ''}
                    </Link>
                  )}
                  {item.scheduled_count > 0 && (
                    <Link
                      to={`/content-types/${item.content_type_id}/entries?status=scheduled`}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                      {item.scheduled_count} scheduled
                    </Link>
                  )}
                  {item.changes_count > 0 && (
                    <Link
                      to={`/content-types/${item.content_type_id}/entries?status=changes`}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                    >
                      {item.changes_count} with changes
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Scheduled */}
      {upcoming.length > 0 && (
        <div className="mb-8">
          <h2 className="text-base font-semibold text-zinc-900 mb-4">Upcoming</h2>
          <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
            {upcoming.map(entry => (
              <div key={entry.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900 truncate">{entry.label}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">{entry.content_type_name}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-blue-600 font-medium">{timeUntil(entry.scheduled_at)}</p>
                  <p className="text-xs text-zinc-400">
                    {new Date(entry.scheduled_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
                <Link
                  to={`/content-types/${entry.content_type_id}/entries/${entry.id}`}
                  className="p-1 rounded text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors shrink-0"
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recently Updated */}
      {recentEntries.length > 0 && (
        <div className="mb-8">
          <h2 className="text-base font-semibold text-zinc-900 mb-4">Recently Updated</h2>
          <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
            {recentEntries.map(entry => (
              <div key={entry.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900 truncate">{entry.label}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">{entry.content_type_name}</p>
                </div>
                <StatusBadge status={entry.status} />
                <span className="text-xs text-zinc-400 shrink-0">{timeAgo(entry.updated_at)}</span>
                <Link
                  to={`/content-types/${entry.content_type_id}/entries/${entry.id}`}
                  className="p-1 rounded text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors shrink-0"
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content Types */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-zinc-900">Collections</h2>
          <Link to="/content-types" className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
            Manage <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {contentTypes.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-dashed border-zinc-200">
            <Database className="h-10 w-10 text-zinc-300 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">No collections yet.</p>
            <Link
              to="/content-types/new"
              className="mt-3 inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              Create your first collection
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {contentTypes.map(ct => (
              <div
                key={ct.id}
                className="flex items-center justify-between bg-white rounded-lg border border-zinc-200 px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition-all group"
              >
                <Link to={`/content-types/${ct.id}/entries`} className="flex-1 min-w-0">
                  <p className="font-medium text-zinc-900 text-sm">{ct.name}</p>
                </Link>
                <div className="flex items-center gap-1">
                  <Link
                    to={`/content-types/${ct.id}/entries/new`}
                    className="p-1.5 rounded text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                    title={`New ${ct.name}`}
                  >
                    <Plus className="h-4 w-4" />
                  </Link>
                  <Link
                    to={`/content-types/${ct.id}/entries`}
                    className="p-1.5 rounded text-zinc-300 group-hover:text-indigo-500 transition-colors"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 px-5 py-4 flex items-center gap-4">
      <div className="shrink-0 w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-zinc-900">{value}</p>
        <p className="text-xs text-zinc-500">{label}</p>
      </div>
    </div>
  );
}
