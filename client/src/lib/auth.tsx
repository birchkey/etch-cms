import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { authApi, clearUserInfo } from './api';

type Role = 'admin' | 'editor';

interface StoredUser {
  username: string;
  name: string | null;
  role: Role;
  mustResetPassword: boolean;
}

interface AuthContextValue {
  username: string | null;
  name: string | null;
  displayName: string | null;
  role: Role | null;
  mustResetPassword: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  clearMustResetPassword: () => void;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

const USER_KEY = 'cms_user';

function loadStoredUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StoredUser | null>(loadStoredUser);

  const login = useCallback(async (username: string, password: string) => {
    const res = await authApi.login(username, password);
    const stored: StoredUser = { username: res.username, name: res.name, role: res.role, mustResetPassword: res.must_reset_password ?? false };
    localStorage.setItem(USER_KEY, JSON.stringify(stored));
    setUser(stored);
  }, []);

  const logout = useCallback(() => {
    authApi.logout().catch(() => {});
    clearUserInfo();
    setUser(null);
  }, []);

  const clearMustResetPassword = useCallback(() => {
    setUser(prev => {
      if (!prev) return null;
      const updated = { ...prev, mustResetPassword: false };
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const displayName = user?.name || user?.username || null;

  return (
    <AuthContext.Provider value={{
      username: user?.username ?? null,
      name: user?.name ?? null,
      displayName,
      role: user?.role ?? null,
      mustResetPassword: user?.mustResetPassword ?? false,
      login,
      logout,
      clearMustResetPassword,
      isAuthenticated: !!user,
      isAdmin: user?.role === 'admin',
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
