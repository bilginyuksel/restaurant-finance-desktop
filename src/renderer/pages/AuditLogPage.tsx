import React, { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useFinance } from '../context/FinanceContext';
import { AuditLog, AuditAction, AUDIT_ALLOWLIST } from '../../shared/types';

// ── helpers ──────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<AuditAction, { label: string; color: string }> = {
  'order.add':             { label: 'Sipariş Eklendi',       color: '#22c55e' },
  'order.update':          { label: 'Sipariş Güncellendi',   color: '#3b82f6' },
  'order.remove':          { label: 'Sipariş Silindi',       color: '#ef4444' },
  'table.update':          { label: 'Masa Güncellendi',      color: '#f59e0b' },
  'table.delete':          { label: 'Masa Silindi',          color: '#ef4444' },
  'table.close':           { label: 'Masa Kapatıldı',       color: '#8b5cf6' },
  'table.reopen':          { label: 'Masa Yeniden Açıldı',  color: '#06b6d4' },
  'product.update':        { label: 'Ürün Güncellendi',      color: '#f59e0b' },
  'product.delete':        { label: 'Ürün Silindi',          color: '#ef4444' },
  'stock_movement.record': { label: 'Stok Hareketi',         color: '#6366f1' },
  'payment.record':        { label: 'Ödeme Alındı',          color: '#10b981' },
};

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const FILTER_ALL = '__all__';

// ── component ─────────────────────────────────────────────────────────────────

export const AuditLogPage: React.FC = () => {
  const { user, userProfile, restaurantId } = useFinance();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<AuditAction | typeof FILTER_ALL>(FILTER_ALL);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Access guard
  const allowed =
    user?.email && (AUDIT_ALLOWLIST as readonly string[]).includes(user.email);

  useEffect(() => {
    if (!restaurantId || !allowed) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'restaurants', restaurantId, 'auditLogs'),
      orderBy('timestamp', 'desc'),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLog));
        setLogs(data);
        setLoading(false);
      },
      (err) => {
        console.error('[AuditLogPage] snapshot error', err);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [restaurantId, allowed]);

  if (!allowed) {
    return (
      <div className="empty-state">
        <p>Bu sayfaya erişim yetkiniz yok.</p>
      </div>
    );
  }

  const filtered = logs.filter((log) => {
    if (actionFilter !== FILTER_ALL && log.action !== actionFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        log.entityName?.toLowerCase().includes(q) ||
        log.performedByEmail?.toLowerCase().includes(q) ||
        log.performedByName?.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const toggleExpand = (id: string) =>
    setExpanded((prev) => (prev === id ? null : id));

  return (
    <>
      {/* Header */}
      <div className="flex-row" style={{ marginBottom: 20, alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Denetim Günlüğü</h2>
        <span className="muted" style={{ fontSize: 14 }}>{filtered.length} kayıt</span>
        <div className="spacer" />
        <input
          className="input"
          placeholder="Ara (masa adı, kullanıcı, işlem)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260 }}
        />
        <select
          className="input"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as AuditAction | typeof FILTER_ALL)}
          style={{ width: 200 }}
        >
          <option value={FILTER_ALL}>Tüm İşlemler</option>
          {(Object.keys(ACTION_LABELS) as AuditAction[]).map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a].label}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="empty-state">Yükleniyor…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>Kayıt bulunamadı.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((log) => {
            const meta = ACTION_LABELS[log.action] ?? { label: log.action, color: '#888' };
            const isOpen = expanded === log.id;
            const hasBefore = log.before && Object.keys(log.before).length > 0;
            const hasAfter = log.after && Object.keys(log.after).length > 0;
            const hasMeta = log.metadata && Object.keys(log.metadata).length > 0;
            const hasDetail = hasBefore || hasAfter || hasMeta;

            return (
              <div
                key={log.id}
                style={{
                  background: 'var(--surface-2, #1e2030)',
                  border: '1px solid var(--border, #2d3148)',
                  borderRadius: 10,
                  overflow: 'hidden',
                }}
              >
                {/* Row */}
                <button
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    padding: '10px 14px',
                    background: 'none',
                    border: 'none',
                    cursor: hasDetail ? 'pointer' : 'default',
                    color: 'inherit',
                    textAlign: 'left',
                  }}
                  onClick={() => hasDetail && toggleExpand(log.id)}
                  aria-expanded={isOpen}
                >
                  {/* Action badge */}
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 20,
                      fontSize: 11,
                      fontWeight: 600,
                      background: meta.color + '22',
                      color: meta.color,
                      whiteSpace: 'nowrap',
                      minWidth: 140,
                      textAlign: 'center',
                    }}
                  >
                    {meta.label}
                  </span>

                  {/* Entity name */}
                  <span style={{ flex: 1, fontWeight: 500 }}>
                    {log.entityName || log.entityId}
                  </span>

                  {/* Performer */}
                  <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {log.performedByName}
                    {log.performedByEmail !== log.performedByName && (
                      <span style={{ opacity: 0.6 }}> &lt;{log.performedByEmail}&gt;</span>
                    )}
                  </span>

                  {/* Timestamp */}
                  <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap', marginLeft: 8 }}>
                    {fmtDate(log.timestamp)}
                  </span>

                  {/* Removal reason badge */}
                  {log.metadata?.removalReason && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 8px',
                        borderRadius: 20,
                        fontSize: 11,
                        fontWeight: 600,
                        background: '#ef444422',
                        color: '#ef4444',
                        whiteSpace: 'nowrap',
                        maxWidth: 200,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        marginLeft: 4,
                      }}
                      title={log.metadata.removalReason}
                    >
                      ⚠️ {log.metadata.removalReason}
                    </span>
                  )}

                  {/* Chevron */}
                  {hasDetail && (
                    <span style={{ marginLeft: 8, opacity: 0.5, fontSize: 12 }}>
                      {isOpen ? '▲' : '▼'}
                    </span>
                  )}
                </button>

                {/* Detail panel */}
                {isOpen && hasDetail && (
                  <div
                    style={{
                      padding: '0 14px 14px',
                      display: 'flex',
                      gap: 16,
                      flexWrap: 'wrap',
                    }}
                  >
                    {hasMeta && (
                      <DetailCard title="Metadata" data={log.metadata!} color="#6366f1" />
                    )}
                    {hasBefore && (
                      <DetailCard title="Önceki Değer" data={log.before!} color="#ef4444" />
                    )}
                    {hasAfter && (
                      <DetailCard title="Yeni Değer" data={log.after!} color="#22c55e" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

// ── DetailCard sub-component ──────────────────────────────────────────────────

const DetailCard: React.FC<{ title: string; data: Record<string, any>; color: string }> = ({
  title,
  data,
  color,
}) => (
  <div
    style={{
      flex: '1 1 280px',
      background: 'var(--surface, #13152b)',
      border: `1px solid ${color}44`,
      borderRadius: 8,
      padding: '10px 12px',
    }}
  >
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color,
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 1,
      }}
    >
      {title}
    </div>
    <pre
      style={{
        margin: 0,
        fontSize: 12,
        fontFamily: 'monospace',
        color: 'var(--text, #e2e8f0)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  </div>
);
