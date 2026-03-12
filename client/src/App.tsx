import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth';
import { SettingsProvider } from '@/lib/settings';
import { Layout } from '@/components/Layout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import ContentTypeList from '@/pages/ContentTypeList';
import ContentTypeForm from '@/pages/ContentTypeForm';
import EntryList from '@/pages/EntryList';
import EntryForm from '@/pages/EntryForm';
import Assets from '@/pages/Assets';
import Users from '@/pages/Users';
import Settings from '@/pages/Settings';
import Webhooks from '@/pages/Webhooks';
import AuditLog from '@/pages/AuditLog';
import { Toaster } from 'sonner';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/content-types" element={<RequireAdmin><ContentTypeList /></RequireAdmin>} />
        <Route path="/content-types/new" element={<RequireAdmin><ContentTypeForm /></RequireAdmin>} />
        <Route path="/content-types/:id" element={<RequireAdmin><ContentTypeForm /></RequireAdmin>} />
        <Route path="/content-types/:typeId/entries" element={<EntryList />} />
        <Route path="/content-types/:typeId/entries/new" element={<EntryForm />} />
        <Route path="/content-types/:typeId/entries/:entryId" element={<EntryForm />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/users" element={<RequireAdmin><Users /></RequireAdmin>} />
        <Route path="/settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
        <Route path="/webhooks" element={<RequireAdmin><Webhooks /></RequireAdmin>} />
        <Route path="/audit-log" element={<RequireAdmin><AuditLog /></RequireAdmin>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SettingsProvider>
        <AuthProvider>
          <AppRoutes />
          <Toaster position="bottom-right" richColors />
        </AuthProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
