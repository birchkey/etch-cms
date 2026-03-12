import { useEffect, useState } from 'react';
import { webhooksApi, Webhook, WebhookCreated, WebhookDelivery } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Plus, Trash2, Send, Copy, ChevronDown, ChevronUp, Zap, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { usePageTitle } from '@/lib/settings';

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function Webhooks() {
  usePageTitle('Webhooks');
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [revealedSecret, setRevealedSecret] = useState<WebhookCreated | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, WebhookDelivery[]>>({});
  const [logsLoading, setLogsLoading] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    webhooksApi.list().then(setHooks).catch(() => toast.error('Failed to load webhooks'));
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) return;
    setAdding(true);
    try {
      const created = await webhooksApi.create(newUrl.trim());
      const { secret, ...hook } = created;
      setHooks(prev => [{ ...hook, secret_hint: '...' + secret.slice(-4) }, ...prev]);
      setNewUrl('');
      setRevealedSecret(created);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add webhook');
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (hook: Webhook) => {
    try {
      const updated = await webhooksApi.update(hook.id, { enabled: !hook.enabled });
      setHooks(prev => prev.map(h => h.id === hook.id ? updated : h));
    } catch {
      toast.error('Update failed');
    }
  };

  const handleDelete = async (hook: Webhook) => {
    if (!confirm('Delete this webhook?')) return;
    try {
      await webhooksApi.delete(hook.id);
      setHooks(prev => prev.filter(h => h.id !== hook.id));
      if (expandedLogs === hook.id) setExpandedLogs(null);
      toast.success('Deleted');
    } catch {
      toast.error('Delete failed');
    }
  };

  const handleTest = async (hook: Webhook) => {
    setTesting(hook.id);
    try {
      const result = await webhooksApi.test(hook.id);
      if (result.ok) {
        toast.success(`Test delivered (${result.status})`);
      } else {
        toast.error(`Test failed: ${result.error ?? result.status}`);
      }
      // Refresh logs if open
      if (expandedLogs === hook.id) {
        loadLogs(hook.id);
      }
    } catch {
      toast.error('Test failed');
    } finally {
      setTesting(null);
    }
  };

  const loadLogs = async (id: string) => {
    setLogsLoading(true);
    try {
      const data = await webhooksApi.deliveries(id);
      setLogs(prev => ({ ...prev, [id]: data }));
    } catch {
      toast.error('Failed to load logs');
    } finally {
      setLogsLoading(false);
    }
  };

  const toggleLogs = (id: string) => {
    if (expandedLogs === id) {
      setExpandedLogs(null);
    } else {
      setExpandedLogs(id);
      loadLogs(id);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Webhooks</h1>
        <p className="text-zinc-500 mt-1">Receive HTTP notifications when content changes.</p>
      </div>

      {/* Add webhook */}
      <form onSubmit={handleAdd} className="flex gap-2 mb-6">
        <Input
          value={newUrl}
          onChange={e => setNewUrl(e.target.value)}
          placeholder="https://example.com/webhook"
          className="flex-1"
        />
        <Button type="submit" disabled={adding}>
          <Plus className="h-4 w-4 mr-2" />
          Add
        </Button>
      </form>

      {/* Webhook list */}
      {hooks.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-zinc-200">
          <Zap className="h-10 w-10 text-zinc-300 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">No webhooks yet. Add one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {hooks.map(hook => (
            <div key={hook.id} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
              {/* Main row */}
              <div className="flex items-center gap-3 px-5 py-4">
                <Switch
                  checked={!!hook.enabled}
                  onCheckedChange={() => handleToggle(hook)}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900 truncate">{hook.url}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <p className="text-xs text-zinc-400 font-mono">{hook.secret_hint}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTest(hook)}
                  disabled={testing === hook.id}
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Test
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(hook)} title="Delete">
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
                <button
                  onClick={() => toggleLogs(hook.id)}
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 transition-colors whitespace-nowrap"
                >
                  Logs
                  {expandedLogs === hook.id
                    ? <ChevronUp className="h-3.5 w-3.5" />
                    : <ChevronDown className="h-3.5 w-3.5" />
                  }
                </button>
              </div>

              {/* Delivery log */}
              {expandedLogs === hook.id && (
                <div className="border-t border-zinc-100">
                  <div className="flex items-center justify-between px-5 py-2 bg-zinc-50 border-b border-zinc-100">
                    <p className="text-xs font-medium text-zinc-500">Recent deliveries</p>
                    <button
                      onClick={() => loadLogs(hook.id)}
                      className="text-zinc-400 hover:text-zinc-600 transition-colors"
                      title="Refresh"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {logsLoading ? (
                    <p className="text-center py-8 text-zinc-400 text-sm">Loading…</p>
                  ) : (logs[hook.id] ?? []).length === 0 ? (
                    <p className="text-center py-8 text-zinc-400 text-sm">No deliveries yet</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-zinc-400 border-b border-zinc-100">
                          <th className="px-5 py-2 text-left font-medium">Event</th>
                          <th className="px-5 py-2 text-left font-medium">Status</th>
                          <th className="px-5 py-2 text-left font-medium">Duration</th>
                          <th className="px-5 py-2 text-left font-medium">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(logs[hook.id] ?? []).map(log => (
                          <tr key={log.id} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50">
                            <td className="px-5 py-2.5 font-mono text-xs text-zinc-700">{log.event}</td>
                            <td className="px-5 py-2.5">
                              {log.success ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {log.status_code}
                                </span>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 text-xs font-medium text-red-600"
                                  title={log.error ?? undefined}
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  {log.status_code ?? 'Error'}
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-2.5 text-xs text-zinc-500">{log.duration_ms}ms</td>
                            <td className="px-5 py-2.5 text-xs text-zinc-400">{timeAgo(log.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Event reference */}
      <div className="mt-8 p-4 bg-zinc-50 rounded-xl border border-zinc-200">
        <p className="text-xs font-semibold text-zinc-500 mb-2">Events</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1">
          {['entry.published', 'entry.updated', 'entry.unpublished', 'entry.deleted', 'webhook.test'].map(e => (
            <p key={e} className="text-xs font-mono text-zinc-600">{e}</p>
          ))}
        </div>
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
    </div>
  );
}
