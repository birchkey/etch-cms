import { useEffect, useState } from 'react';
import { apiTokensApi, ApiToken, ApiTokenCreated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Plus, Trash2, Copy, KeySquare } from 'lucide-react';
import { toast } from 'sonner';
import { usePageTitle } from '@/lib/settings';

const EXPIRY_OPTIONS: [string, string][] = [
  ['30', '30 days'],
  ['90', '90 days'],
  ['365', '1 year'],
  ['never', 'No expiry'],
];

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ApiTokens() {
  usePageTitle('API Tokens');
  const { isAdmin, username } = useAuth();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('90');
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<ApiTokenCreated | null>(null);
  // Fixed at mount: good enough for flagging expired tokens, and keeps render pure.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    apiTokensApi.list()
      .then(setTokens)
      .catch(() => toast.error('Failed to load API tokens'))
      .finally(() => setLoaded(true));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const created = await apiTokensApi.create({
        name: name.trim(),
        expires_in_days: expiry === 'never' ? null : Number(expiry),
      });
      const { token: _token, ...row } = created;
      setTokens(prev => [row, ...prev]);
      setName('');
      setRevealed(created);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (t: ApiToken) => {
    if (!confirm(`Revoke "${t.name}"? Anything using it will stop working immediately.`)) return;
    try {
      await apiTokensApi.revoke(t.id);
      setTokens(prev => prev.filter(x => x.id !== t.id));
      toast.success('Token revoked');
    } catch {
      toast.error('Revoke failed');
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied');
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">API Tokens</h1>
        <p className="text-zinc-500 mt-1">
          Let scripts and integrations use the admin API as you. A token has the same access you do.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-2 mb-6">
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Token name, e.g. Import script"
          maxLength={100}
          className="flex-1"
        />
        <Select value={expiry} onValueChange={setExpiry}>
          <SelectTrigger className="sm:w-36" aria-label="Expires after">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_OPTIONS.map(([val, label]) => (
              <SelectItem key={val} value={val}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={creating || !name.trim()}>
          <Plus className="h-4 w-4 mr-2" />
          Create
        </Button>
      </form>

      {loaded && tokens.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-zinc-200">
          <KeySquare className="h-10 w-10 text-zinc-300 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">No API tokens yet. Create one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tokens.map(t => {
            const expired = t.expires_at !== null && t.expires_at <= now;
            return (
              <div key={t.id} className="bg-white rounded-xl border border-zinc-200 flex items-center gap-3 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-zinc-900 truncate">{t.name}</p>
                    {expired && (
                      <span className="text-xs font-medium text-red-600 bg-red-50 rounded px-1.5 py-0.5">Expired</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="font-mono">{t.token_hint}…</span>
                    {isAdmin && t.owner_sub !== username && <span>Owner: {t.owner_sub}</span>}
                    <span>Created {formatDate(t.created_at)}</span>
                    <span>{t.last_used_at ? `Last used ${timeAgo(t.last_used_at)}` : 'Never used'}</span>
                    {!expired && <span>{t.expires_at ? `Expires ${formatDate(t.expires_at)}` : 'No expiry'}</span>}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleRevoke(t)} title="Revoke">
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 p-4 bg-zinc-50 rounded-xl border border-zinc-200">
        <p className="text-xs font-semibold text-zinc-500 mb-2">Usage</p>
        <p className="text-xs text-zinc-600 mb-2">Send the token as a Bearer token with any <code className="font-mono">/api/</code> request:</p>
        <pre className="text-xs font-mono text-zinc-700 bg-white border border-zinc-200 rounded-lg p-3 overflow-x-auto">
{`curl ${window.location.origin}/api/content-types \\
  -H "Authorization: Bearer etch_…"`}
        </pre>
      </div>

      <Dialog open={!!revealed} onOpenChange={open => { if (!open) setRevealed(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new API token</DialogTitle>
            <DialogDescription>
              Copy it now. It won't be shown again. Treat it like a password: anyone with it can do what you can.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 mt-2 p-3 bg-zinc-50 rounded-lg border border-zinc-200">
            <code className="text-sm font-mono text-zinc-800 flex-1 break-all">{revealed?.token}</code>
            <button
              type="button"
              title="Copy token"
              onClick={() => revealed && copy(revealed.token)}
              className="shrink-0 text-zinc-400 hover:text-zinc-600"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <Button className="w-full mt-2" onClick={() => setRevealed(null)}>Done</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
