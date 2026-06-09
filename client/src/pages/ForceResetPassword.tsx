import { useState } from 'react';
import { authApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

export default function ForceResetPassword() {
  const { clearMustResetPassword, displayName } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    setSaving(true);
    try {
      await authApi.forceChangePassword(password);
      clearMustResetPassword();
      toast.success('Password updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 w-full max-w-sm p-8 space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="bg-indigo-100 text-indigo-600 rounded-full p-3">
            <KeyRound className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Set a new password</h1>
            {displayName && (
              <p className="text-sm text-zinc-500 mt-1">Welcome, {displayName}. You must create a new password before continuing.</p>
            )}
            {!displayName && (
              <p className="text-sm text-zinc-500 mt-1">You must create a new password before continuing.</p>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>New Password</Label>
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              required
              minLength={8}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm Password</Label>
            <Input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat new password"
              required
              minLength={8}
            />
          </div>
          <Button type="submit" className="w-full" disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Set Password
          </Button>
        </form>
      </div>
    </div>
  );
}
