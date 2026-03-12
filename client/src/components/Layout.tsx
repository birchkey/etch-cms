import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <Sidebar />
      <main className="ml-60 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
