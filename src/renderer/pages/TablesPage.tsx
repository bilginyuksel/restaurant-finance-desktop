import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFinance } from '../context/FinanceContext';
import { TableCard } from '../components/TableCard';
import { ConfirmModal } from '../components/ConfirmModal';
import { toastError } from '../components/Toast';
import { Table } from '../../shared/types';

const newId = () => `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const TablesPage: React.FC = () => {
  const { tables, recipesById, addTable, tableGroups, tableLayout } = useFinance();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedGroup = searchParams.get('group') ?? '__all__';
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [newTableGroup, setNewTableGroup] = useState<string>('');

  const activeTables = tables.filter((t) => t.status !== 'closed');
  const filteredTables =
    selectedGroup === '__all__'
      ? activeTables
      : activeTables.filter((t) => (t.group ?? '') === selectedGroup);

  // Placeholder slots — generated per group only.
  // Preset IDs: `preset_${groupId}_${i}`
  // Placeholders appear in the group's own tab and in the "Tümü" view.
  const placeholders: Table[] = [];
  const addPresets = (count: number, groupId: string) => {
    const prefix =
      tableLayout?.groupPrefixes?.[groupId] ||
      (tableGroups.find((g) => g.id === groupId)?.name ?? '').slice(0, 2).toUpperCase() ||
      'M';
    for (let i = 1; i <= count; i++) {
      const presetId = `preset_${groupId}_${i}`;
      const slotName = `${prefix} ${i}`;
      // Suppress the placeholder if the slot is currently occupied either:
      //   1) by the original lazy-created doc with the preset ID, or
      //   2) by a fresh table reusing the slot (same name + group) after the
      //      previous one was closed.
      const occupied = activeTables.some(
        (t) =>
          t.id === presetId ||
          (t.name === slotName && (t.group ?? '') === groupId),
      );
      if (!occupied) {
        placeholders.push({
          id: presetId,
          name: slotName,
          group: groupId,
          status: 'active',
          createdAt: '',
          orders: [],
          totalPrice: 0,
          transactions: [],
        });
      }
    }
  };

  if (selectedGroup === '__all__') {
    for (const [gId, count] of Object.entries(tableLayout?.groupPresets ?? {})) {
      addPresets(count, gId);
    }
  } else {
    addPresets(tableLayout?.groupPresets?.[selectedGroup] ?? 0, selectedGroup);
  }

  const handleCreate = async () => {
    const n = name.trim();
    if (!n) {
      toastError('Masa adı boş olamaz');
      return;
    }
    const group = newTableGroup || (selectedGroup !== '__all__' ? selectedGroup : undefined);
    const t: Table = {
      id: newId(),
      name: n,
      ...(group ? { group } : {}),
      status: 'active',
      createdAt: new Date().toISOString(),
      orders: [],
      totalPrice: 0,
      transactions: [],
    };
    try {
      await addTable(t);
      setCreating(false);
      setName('');
      setNewTableGroup('');
      navigate(`/table/${t.id}`);
    } catch (err) {
      console.error(err);
      toastError('Masa oluşturulamadı');
    }
  };

  const openCreate = () => {
    setNewTableGroup(selectedGroup !== '__all__' ? selectedGroup : '');
    setCreating(true);
  };

  // Opening a table slot:
  // - Real (non-preset) tables: navigate to existing doc.
  // - Preset placeholder: pre-generate a clean `t_<ts>_<rand>` ID and
  //   navigate with the slot's identity in router state. The Firestore doc
  //   is NOT created yet — TableDetailPage renders a synthetic empty table
  //   from the draft state. The doc is materialised on the first save
  //   (e.g. when the user sends an order to the kitchen). If the user
  //   backs out without ordering, no orphan doc is left behind.
  const openTable = (t: Table) => {
    if (!t.id.startsWith('preset_')) {
      navigate(`/table/${t.id}`);
      return;
    }
    const draftId = newId();
    navigate(`/table/${draftId}`, {
      state: { draft: { name: t.name, group: t.group ?? null } },
    });
  };

  return (
    <>
      <div className="flex-row" style={{ marginBottom: 16, alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Masalar</h2>
        <div className="spacer" />
        <button className="btn primary large" onClick={openCreate}>
          + Yeni Masa
        </button>
      </div>

      {filteredTables.length === 0 && placeholders.length === 0 ? (
        <div className="empty-state">
          <p>Henüz açık masa yok.</p>
          <button className="btn primary" onClick={openCreate}>
            İlk masayı oluştur
          </button>
        </div>
      ) : (
        <div className="tables-grid">
          {filteredTables.map((t) => (
            <TableCard key={t.id} table={t} recipes={recipesById} onOpen={openTable} />
          ))}
          {placeholders.map((t) => (
            <TableCard key={t.id} table={t} recipes={recipesById} onOpen={openTable} />
          ))}
        </div>
      )}

      <ConfirmModal
        open={creating}
        title="Yeni Masa"
        confirmLabel="Oluştur"
        onConfirm={handleCreate}
        onCancel={() => { setCreating(false); setName(''); setNewTableGroup(''); }}
      >
        <label className="label">Masa Adı / Numarası</label>
        <input
          className="input"
          placeholder="Örn: 5, Bahçe-2, VIP"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
        />
        {tableGroups.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <label className="label">Grup</label>
            <select
              className="input"
              value={newTableGroup}
              onChange={(e) => setNewTableGroup(e.target.value)}
            >
              <option value="">— Grupsuz —</option>
              {tableGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}
      </ConfirmModal>
    </>
  );
};
