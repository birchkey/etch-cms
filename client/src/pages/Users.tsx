import { useEffect, useState } from 'react';
import { usersApi, contentTypesApi, CmsUser, ContentType } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Trash2, KeyRound, Loader2, Users as UsersIcon, Pencil, Shield, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { usePageTitle } from '@/lib/settings';

export default function Users() {
  usePageTitle('Users');
  const { username: currentUsername } = useAuth();
  const [users, setUsers] = useState<CmsUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<CmsUser | null>(null);
  const [editNameTarget, setEditNameTarget] = useState<CmsUser | null>(null);
  const [permissionsTarget, setPermissionsTarget] = useState<CmsUser | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [clearingReset, setClearingReset] = useState<string | null>(null);

  useEffect(() => {
    usersApi.list()
      .then(setUsers)
      .catch(() => toast.error('Failed to load users'))
      .finally(() => setLoading(false));
  }, []);

  const handleClearReset = async (user: CmsUser) => {
    setClearingReset(user.id);
    try {
      const updated = await usersApi.setMustReset(user.id, false);
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
      toast.success('Reset flag cleared');
    } catch {
      toast.error('Failed to clear flag');
    } finally {
      setClearingReset(null);
    }
  };

  const handleDelete = async (user: CmsUser) => {
    if (!confirm(`Remove "${user.username}"? They will lose access immediately.`)) return;
    setDeleting(user.id);
    try {
      await usersApi.delete(user.id);
      setUsers(prev => prev.filter(u => u.id !== user.id));
      toast.success('User removed');
    } catch {
      toast.error('Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Users</h1>
          <p className="text-zinc-500 text-sm mt-1">Manage editor accounts.</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Editor
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-zinc-200">
          <UsersIcon className="h-12 w-12 text-zinc-300 mx-auto mb-4" />
          <p className="text-zinc-600 font-medium">No editors yet</p>
          <p className="text-zinc-400 text-sm mt-1 mb-6">Add an editor to let others manage content.</p>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Editor
          </Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
          {users.map(user => {
            const initial = (user.name || user.username)[0].toUpperCase();
            return (
              <div key={user.id} className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 group transition-colors">
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold shrink-0">
                  {initial}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-zinc-900 text-sm">{user.name || user.username}</p>
                    {user.must_reset_password === 1 && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0">Reset required</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400">
                    {user.name ? `${user.username} · ` : ''}Editor · Added {new Date(user.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Edit name"
                    onClick={() => setEditNameTarget(user)}
                  >
                    <Pencil className="h-4 w-4 text-zinc-500" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Manage permissions"
                    onClick={() => setPermissionsTarget(user)}
                  >
                    <Shield className="h-4 w-4 text-zinc-500" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Reset password"
                    onClick={() => setResetTarget(user)}
                  >
                    <KeyRound className="h-4 w-4 text-zinc-500" />
                  </Button>
                  {user.must_reset_password === 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Clear password reset requirement"
                      disabled={clearingReset === user.id}
                      onClick={() => handleClearReset(user)}
                    >
                      {clearingReset === user.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <RotateCcw className="h-4 w-4 text-amber-500" />}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    title={user.username === currentUsername ? 'Cannot delete your own account' : 'Remove user'}
                    onClick={() => handleDelete(user)}
                    disabled={deleting === user.id || user.username === currentUsername}
                  >
                    {deleting === user.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4 text-red-400" />
                    }
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={user => {
          setUsers(prev => [user, ...prev]);
          setCreateOpen(false);
        }}
      />

      <EditNameDialog
        user={editNameTarget}
        onClose={() => setEditNameTarget(null)}
        onSaved={updated => {
          setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
          setEditNameTarget(null);
        }}
      />

      <ResetPasswordDialog
        user={resetTarget}
        onClose={() => setResetTarget(null)}
        onReset={updated => setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))}
      />

      <PermissionsDialog
        user={permissionsTarget}
        onClose={() => setPermissionsTarget(null)}
      />
    </div>
  );
}

function CreateUserDialog({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (user: CmsUser) => void;
}) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const user = await usersApi.create(username, password, name);
      toast.success(`Editor "${user.name || user.username}" created`);
      setName('');
      setUsername('');
      setPassword('');
      onCreated(user);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Editor</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name <span className="text-zinc-400 font-normal">(optional)</span></Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Jane Smith"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="jane"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              required
              minLength={8}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditNameDialog({
  user, onClose, onSaved,
}: {
  user: CmsUser | null;
  onClose: () => void;
  onSaved: (user: CmsUser) => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) setName(user.name ?? '');
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      const updated = await usersApi.updateName(user.id, name);
      toast.success('Name updated');
      onSaved(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update name');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Name — {user?.username}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Jane Smith"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PermissionsDialog({ user, onClose }: { user: CmsUser | null; onClose: () => void }) {
  const [contentTypes, setContentTypes] = useState<ContentType[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([contentTypesApi.list(), usersApi.getPermissions(user.id)])
      .then(([types, perms]) => {
        setContentTypes(types);
        if (perms.contentTypeIds.length > 0) {
          setRestricted(true);
          setSelectedIds(new Set(perms.contentTypeIds));
        } else {
          setRestricted(false);
          setSelectedIds(new Set());
        }
      })
      .catch(() => toast.error('Failed to load permissions'))
      .finally(() => setLoading(false));
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const contentTypeIds = restricted ? [...selectedIds] : [];
      await usersApi.setPermissions(user.id, contentTypeIds);
      toast.success('Permissions updated');
      onClose();
    } catch {
      toast.error('Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  const toggleId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={!!user} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Permissions — {user?.username}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="restrict-toggle"
                checked={restricted}
                onCheckedChange={v => {
                  setRestricted(v);
                  if (!v) setSelectedIds(new Set());
                }}
              />
              <Label htmlFor="restrict-toggle" className="cursor-pointer font-normal">
                Restrict to specific content types
              </Label>
            </div>
            {restricted && (
              <div className="space-y-2 pl-2 border-l-2 border-zinc-100 ml-1">
                {contentTypes.length === 0 ? (
                  <p className="text-sm text-zinc-400 pl-2">No content types defined yet.</p>
                ) : (
                  contentTypes.map(ct => (
                    <label key={ct.id} className="flex items-center gap-3 pl-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-zinc-300 accent-indigo-600"
                        checked={selectedIds.has(ct.id)}
                        onChange={() => toggleId(ct.id)}
                      />
                      <span className="text-sm text-zinc-700">{ct.name}</span>
                    </label>
                  ))
                )}
              </div>
            )}
            {!restricted && (
              <p className="text-sm text-zinc-500">
                This editor can access all content types.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onReset }: { user: CmsUser | null; onClose: () => void; onReset?: (updated: CmsUser) => void }) {
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await usersApi.resetPassword(user.id, password);
      toast.success('Password updated — user will be required to reset on next login');
      onReset?.({ ...user, must_reset_password: 1 });
      setPassword('');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset Password — {user?.username}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>New Password</Label>
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              autoFocus
              required
              minLength={8}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Update Password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
