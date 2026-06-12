import React from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useFinance } from './context/FinanceContext';
import { LoginPage } from './pages/LoginPage';
import { TablesPage } from './pages/TablesPage';
import { TableDetailPage } from './pages/TableDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { QuickSalePage } from './pages/QuickSalePage';
import { HistoryPage } from './pages/HistoryPage';
import { ReportsPage } from './pages/ReportsPage';
import { StockManagementPage } from './pages/StockManagementPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { OnlineBadge } from './components/OnlineBadge';
import { ToastHost } from './components/Toast';
import { authApi } from './firebase/auth';
import { AUDIT_ALLOWLIST } from '../shared/types';

export const App: React.FC = () => {
  const { user, authReady, tableGroups, tables, restaurantId } = useFinance();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedGroup = searchParams.get('group') ?? '__all__';
  const activeTables = tables.filter((t) => t.status !== 'closed');
  const canSeeAudit = !!user?.email && (AUDIT_ALLOWLIST as readonly string[]).includes(user.email);

  React.useEffect(() => {
    if (!user || !restaurantId) return;

    let presenceService: import('./services/DesktopPresenceService').DesktopPresenceService;
    let printJobListener: import('./services/PrintJobListener').PrintJobListener;

    const initServices = async () => {
      const { DesktopPresenceService } = await import('./services/DesktopPresenceService');
      const { PrintJobListener } = await import('./services/PrintJobListener');
      
      const tag = await window.api.deviceTag();
      if (!tag) return;

      presenceService = new DesktopPresenceService(restaurantId, tag);
      printJobListener = new PrintJobListener(restaurantId, tag);

      presenceService.start();
      printJobListener.start();
    };

    initServices();

    return () => {
      presenceService?.stop();
      printJobListener?.stop();
    };
  }, [user, restaurantId]);

  if (!authReady) {
    return <div className="empty-state">Yükleniyor…</div>;
  }

  if (!user) {
    return (
      <>
        <LoginPage />
        <ToastHost />
      </>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Restaurant Finance</h1>
        <nav>
          <NavLink to="/tables" className={({ isActive }) => (isActive ? 'active' : '')}>
            Masalar{tableGroups.length > 0 ? ` (${activeTables.length})` : ''}
          </NavLink>
          {tableGroups.length > 0 && (
            <>
              {tableGroups.map((g) => {
                const count = activeTables.filter((t) => (t.group ?? '') === g.id).length;
                return (
                  <button
                    key={g.id}
                    className={`nav-group-tab${selectedGroup === g.id ? ' active' : ''}`}
                    onClick={() => navigate(`/tables?group=${g.id}`)}
                  >
                    {g.name} ({count})
                  </button>
                );
              })}
            </>
          )}
          <NavLink to="/quick-sale" className={({ isActive }) => (isActive ? 'active' : '')}>
            Peşin Satış
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => (isActive ? 'active' : '')}>
            Geçmiş
          </NavLink>
          <NavLink to="/reports" className={({ isActive }) => (isActive ? 'active' : '')}>
            Raporlar
          </NavLink>
          <NavLink to="/stock" className={({ isActive }) => (isActive ? 'active' : '')}>
            Stok
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
            Ayarlar
          </NavLink>
          {canSeeAudit && (
            <NavLink to="/audit" className={({ isActive }) => (isActive ? 'active' : '')}>
              Denetim
            </NavLink>
          )}
        </nav>
        <OnlineBadge />
        <button className="btn small" onClick={() => authApi.signOut()}>Çıkış</button>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/tables" replace />} />
          <Route path="/tables" element={<TablesPage />} />
          <Route path="/table/:id" element={<TableDetailPage />} />
          <Route path="/quick-sale" element={<QuickSalePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/stock" element={<StockManagementPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/audit" element={<AuditLogPage />} />
          <Route path="*" element={<Navigate to="/tables" replace />} />
        </Routes>
      </main>
      <ToastHost />
    </div>
  );
};
