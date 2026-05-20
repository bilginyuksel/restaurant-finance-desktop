import React, { useEffect, useMemo, useState } from 'react';
import type {
  CategoryRouting,
  NamedPrinterConfig,
  PrinterConfig,
  PrintersConfig,
  PrinterTarget,
  SystemPrinter,
} from '../../shared/receipt';
import { toastError, toastSuccess } from '../components/Toast';
import { useFinance } from '../context/FinanceContext';

const targets: { key: PrinterTarget; label: string }[] = [
  { key: 'customer', label: 'Müşteri / Bar Yazıcısı' },
  { key: 'kitchen', label: 'Mutfak Yazıcısı (Varsayılan)' },
];

const CHARSETS = [
  'PC857_TURKISH',
  'PC437_USA',
  'PC850_MULTILINGUAL',
  'WPC1252',
  'PC852_LATIN2',
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || `p-${Date.now().toString(36)}`;

const blankPrinter = (): PrinterConfig => ({
  enabled: true,
  type: 'epson',
  interface: 'tcp://192.168.1.100',
  characterSet: 'PC857_TURKISH',
  width: 42,
  cashDrawer: false,
});

interface SystemPrinterPickerProps {
  systemPrinters: SystemPrinter[];
  onPick: (iface: string) => void;
}

const SystemPrinterPicker: React.FC<SystemPrinterPickerProps> = ({ systemPrinters, onPick }) => {
  const [value, setValue] = useState('');
  if (systemPrinters.length === 0) {
    return (
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Sistemde kurulu yazıcı bulunamadı (ya da yalnızca ağ yazıcısı kullanıyorsunuz).
      </div>
    );
  }
  return (
    <div className="flex-row" style={{ marginTop: 4 }}>
      <select
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      >
        <option value="">Sistemdeki yazıcılardan seç…</option>
        {systemPrinters.map((p) => (
          <option key={p.name} value={p.name}>
            {p.displayName || p.name}{p.isDefault ? '  (varsayılan)' : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn"
        disabled={!value}
        onClick={() => {
          onPick(`printer:${value}`);
          setValue('');
        }}
      >
        Kullan
      </button>
    </div>
  );
};

interface PrinterFieldsProps {
  cfg: PrinterConfig;
  onChange: (patch: Partial<PrinterConfig>) => void;
  showCashDrawer?: boolean;
  systemPrinters: SystemPrinter[];
}

const PrinterFields: React.FC<PrinterFieldsProps> = ({ cfg, onChange, showCashDrawer, systemPrinters }) => (
  <>
    <label className="flex-row">
      <input
        type="checkbox"
        checked={cfg.enabled}
        onChange={(e) => onChange({ enabled: e.target.checked })}
      />
      <span>Bu yazıcı etkin</span>
    </label>
    <div>
      <label className="label">Tip</label>
      <select className="input" value={cfg.type} onChange={(e) => onChange({ type: e.target.value as 'epson' | 'star' })}>
        <option value="epson">Epson</option>
        <option value="star">Star</option>
      </select>
    </div>
    <div>
      <label className="label">Arayüz</label>
      <input
        className="input"
        placeholder="tcp://192.168.1.100  veya  printer:Star_TSP100"
        value={cfg.interface}
        onChange={(e) => onChange({ interface: e.target.value })}
      />
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Ağ: <code>tcp://IP:9100</code> · USB/Sistem: <code>printer:&lt;ad&gt;</code>
      </div>
      <SystemPrinterPicker
        systemPrinters={systemPrinters}
        onPick={(iface) => onChange({ interface: iface })}
      />
    </div>
    <div>
      <label className="label">Karakter Seti</label>
      <select
        className="input"
        value={cfg.characterSet ?? 'PC857_TURKISH'}
        onChange={(e) => onChange({ characterSet: e.target.value })}
      >
        {CHARSETS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
    <div>
      <label className="label">Genişlik (karakter)</label>
      <input
        className="input"
        type="number"
        value={cfg.width ?? 42}
        onChange={(e) => onChange({ width: parseInt(e.target.value, 10) || 42 })}
      />
    </div>
    {showCashDrawer && (
      <label className="flex-row">
        <input
          type="checkbox"
          checked={!!cfg.cashDrawer}
          onChange={(e) => onChange({ cashDrawer: e.target.checked })}
        />
        <span>Kasa çekmecesini aç</span>
      </label>
    )}
  </>
);

export const SettingsPage: React.FC = () => {
  const [printers, setPrinters] = useState<PrintersConfig | null>(null);
  const [extraPrinters, setExtraPrinters] = useState<Record<string, NamedPrinterConfig>>({});
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinter[]>([]);
  const [routing, setRouting] = useState<CategoryRouting>({});
  const [restaurantId, setRestaurantId] = useState('');
  const [deviceTag, setDeviceTag] = useState('');
  const [savingTarget, setSavingTarget] = useState<string | null>(null);
  const [newPrinterName, setNewPrinterName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const { user, categories, tableGroups, addTableGroup, deleteTableGroup, tableLayout, setTableLayout } = useFinance();
  const [groupPresets, setGroupPresets] = useState<Record<string, number>>({});
  const [groupPrefixes, setGroupPrefixes] = useState<Record<string, string>>({});

  // Only initialise local state from Firestore on the FIRST non-null load.
  // Without this guard, every snapshot (persistentLocalCache fires at least
  // twice: once from cache, once from server) creates a new tableLayout object
  // reference, re-runs the effect, and wipes anything the user has typed.
  const layoutInitialized = React.useRef(false);
  useEffect(() => {
    if (tableLayout !== null && !layoutInitialized.current) {
      layoutInitialized.current = true;
      setGroupPresets(tableLayout.groupPresets ?? {});
      setGroupPrefixes(tableLayout.groupPrefixes ?? {});
    }
    if (tableLayout === null) {
      layoutInitialized.current = false;
    }
  }, [tableLayout]);

  useEffect(() => {
    void (async () => {
      setPrinters(await window.api.getPrinters());
      setRestaurantId(await window.api.getRestaurantId());
      setExtraPrinters(await window.api.getExtraPrinters());
      setRouting(await window.api.getCategoryRouting());
      setSystemPrinters(await window.api.listSystemPrinters());
      setDeviceTag(await window.api.deviceTag());
    })();
  }, []);

  const refreshSystemPrinters = async () => {
    setSystemPrinters(await window.api.listSystemPrinters());
    toastSuccess('Yazıcı listesi güncellendi');
  };

  const update = (target: PrinterTarget, patch: Partial<PrinterConfig>) => {
    setPrinters((p) => (p ? { ...p, [target]: { ...p[target], ...patch } } : p));
  };

  const save = async (target: PrinterTarget) => {
    if (!printers) return;
    setSavingTarget(target);
    try {
      const next = await window.api.setPrinter(target, printers[target]);
      setPrinters(next);
      toastSuccess('Kaydedildi');
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setSavingTarget(null);
    }
  };

  const test = async (target: PrinterTarget) => {
    const res = await window.api.testPrint(target);
    if (res.ok) toastSuccess('Test fişi gönderildi');
    else toastError(res.error ?? 'Bilinmeyen hata');
  };

  const saveTableLayout = async () => {
    const cleanGroupPresets: Record<string, number> = {};
    for (const [id, n] of Object.entries(groupPresets)) {
      const v = Math.max(0, Math.floor(n));
      if (v > 0) cleanGroupPresets[id] = v;
    }
    const cleanGroupPrefixes: Record<string, string> = {};
    for (const [id, p] of Object.entries(groupPrefixes)) {
      if (p.trim()) cleanGroupPrefixes[id] = p.trim();
    }
    try {
      await setTableLayout({
        groupPresets: cleanGroupPresets,
        groupPrefixes: cleanGroupPrefixes,
      });
      toastSuccess('Masa düzeni kaydedildi');
    } catch (err) {
      toastError((err as Error).message);
    }
  };

  const saveDeviceTag = async () => {
    if (!deviceTag.trim()) return;
    const next = await window.api.setDeviceTag(deviceTag.trim());
    setDeviceTag(next);
    toastSuccess('Cihaz kimliği güncellendi.');
  };

  const saveRestaurant = async () => {
    if (!restaurantId.trim()) return;
    await window.api.setRestaurantId(restaurantId.trim());
    toastSuccess('Restoran kimliği kaydedildi. Tekrar açın.');
  };

  const addGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      toastError('Grup adı boş olamaz');
      return;
    }
    const id = slug(name);
    await addTableGroup({ id, name, order: tableGroups.length });
    setNewGroupName('');
    toastSuccess(`Grup eklendi: ${name}`);
  };

  // ---- extra printers ----
  const updateExtra = (id: string, patch: Partial<NamedPrinterConfig>) => {
    setExtraPrinters((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  };

  const saveExtra = async (id: string) => {
    const cfg = extraPrinters[id];
    if (!cfg) return;
    setSavingTarget(id);
    try {
      const next = await window.api.setExtraPrinter(cfg);
      setExtraPrinters(next);
      toastSuccess('Kaydedildi');
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setSavingTarget(null);
    }
  };

  const testExtra = async (id: string) => {
    const res = await window.api.testPrintById(id);
    if (res.ok) toastSuccess('Test fişi gönderildi');
    else toastError(res.error ?? 'Bilinmeyen hata');
  };

  const deleteExtra = async (id: string) => {
    const next = await window.api.deleteExtraPrinter(id);
    setExtraPrinters(next);
    setRouting(await window.api.getCategoryRouting());
    toastSuccess('Yazıcı silindi');
  };

  const addExtra = async () => {
    const name = newPrinterName.trim();
    if (!name) {
      toastError('Yazıcıya bir ad verin');
      return;
    }
    let id = slug(name);
    if (id === 'customer' || id === 'kitchen' || extraPrinters[id]) {
      id = `${id}-${Date.now().toString(36).slice(-4)}`;
    }
    const cfg: NamedPrinterConfig = { id, name, ...blankPrinter() };
    const next = await window.api.setExtraPrinter(cfg);
    setExtraPrinters(next);
    setNewPrinterName('');
    toastSuccess(`Yazıcı eklendi: ${name}`);
  };

  // ---- category routing ----
  const printerOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: '', label: 'Varsayılan Mutfak' },
      { value: 'kitchen', label: 'Mutfak Yazıcısı' },
      { value: 'customer', label: 'Müşteri / Bar Yazıcısı' },
    ];
    for (const ep of Object.values(extraPrinters)) {
      opts.push({ value: ep.id, label: ep.name });
    }
    return opts;
  }, [extraPrinters]);

  const updateRouting = (category: string, printerId: string) => {
    setRouting((r) => {
      const next = { ...r };
      if (!printerId) delete next[category];
      else next[category] = printerId;
      return next;
    });
  };

  const saveRouting = async () => {
    const next = await window.api.setCategoryRouting(routing);
    setRouting(next);
    toastSuccess('Kategori yönlendirmeleri kaydedildi');
  };

  if (!printers) return <div className="empty-state">Yükleniyor…</div>;

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Ayarlar</h2>

      <div className="settings-card" style={{ maxWidth: 600, marginBottom: 24 }}>
        <h3>Genel</h3>
        <div>
          <label className="label">Oturum</label>
          <div className="muted">{user?.email ?? '-'}</div>
        </div>
        <div>
          <label className="label">Cihaz Kimliği (Etiket)</label>
          <div className="flex-row">
            <input 
              className="input" 
              value={deviceTag} 
              maxLength={10} 
              style={{ textTransform: 'uppercase' }}
              onChange={(e) => setDeviceTag(e.target.value.toUpperCase())} 
            />
            <button className="btn primary" onClick={saveDeviceTag}>Kaydet</button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Sipariş numaralarında cihazı belirten kısa kod (örn: ABC).
          </div>
        </div>
        <div>
          <label className="label">Restoran Kimliği (Firestore)</label>
          <div className="flex-row">
            <input className="input" value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} />
            <button className="btn primary" onClick={saveRestaurant}>Kaydet</button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Mobil uygulamadaki ile aynı olmalı. Varsayılan: <code>restaurant-1</code>
          </div>
        </div>
      </div>

      <div className="settings-card" style={{ maxWidth: 600, marginBottom: 24 }}>
        <h3>Masa Grupları</h3>
        {tableGroups.length === 0 ? (
          <div className="muted" style={{ marginBottom: 8 }}>Henüz grup tanımlanmamış.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <div className="flex-row" style={{ gap: 8, fontSize: 12, color: 'var(--text-muted)', paddingBottom: 4 }}>
              <span style={{ flex: 1 }}>Grup</span>
              <span style={{ width: 140 }}>Ön ek</span>
              <span style={{ width: 70, textAlign: 'center' }}>Slot</span>
              <span style={{ width: 48 }}></span>
            </div>
            {tableGroups.map((g) => (
              <div key={g.id} className="flex-row" style={{ alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, fontWeight: 600 }}>{g.name}</span>
                <input
                  className="input"
                  placeholder={`Ön ek (varsayılan: ${g.name.slice(0, 2).toUpperCase()})`}
                  style={{ width: 140 }}
                  value={groupPrefixes[g.id] ?? ''}
                  onChange={(e) =>
                    setGroupPrefixes((prev) => ({ ...prev, [g.id]: e.target.value }))
                  }
                />
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  style={{ width: 70 }}
                  value={groupPresets[g.id] ?? 0}
                  onChange={(e) =>
                    setGroupPresets((prev) => ({ ...prev, [g.id]: parseInt(e.target.value, 10) || 0 }))
                  }
                />
                <button className="btn danger small" style={{ width: 48 }} onClick={() => deleteTableGroup(g.id)}>Sil</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex-row" style={{ marginBottom: 8 }}>
          <input
            className="input"
            placeholder="Örn: Havuz, Restoran, Mangal"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addGroup(); }}
          />
          <button className="btn primary" onClick={addGroup}>Ekle</button>
        </div>
        {tableGroups.length > 0 && (
          <>
            <div className="flex-row" style={{ marginTop: 4 }}>
              <button className="btn primary" onClick={saveTableLayout}>Kaydet</button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Her grup için gösterilecek boş masa slotu sayısı. Sipariş eklenince otomatik oluşturulur. 0 = devre dışı.
            </div>
          </>
        )}
      </div>

      <div className="settings-card" style={{ maxWidth: 600, marginBottom: 24 }}>
        <h3>Sistemdeki Yazıcılar</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          İşletim sisteminde kurulu yazıcılar. Ağ üzerindeki ham TCP yazıcıları (tcp://…) burada görünmez.
        </div>
        {systemPrinters.length === 0 ? (
          <div className="muted">Bulunan yazıcı yok.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {systemPrinters.map((p) => (
              <li key={p.name}>
                <b>{p.displayName || p.name}</b>{' '}
                {p.isDefault && <span className="muted">(varsayılan)</span>}
                <div className="muted" style={{ fontSize: 12 }}>
                  <code>printer:{p.name}</code>
                  {p.description ? ` · ${p.description}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: 8 }}>
          <button className="btn" onClick={refreshSystemPrinters}>Yenile</button>
        </div>
      </div>

      <div className="settings-grid">
        {targets.map(({ key, label }) => {
          const cfg = printers[key];
          return (
            <div className="settings-card" key={key}>
              <h3>{label}</h3>
              <PrinterFields
                cfg={cfg}
                onChange={(patch) => update(key, patch)}
                showCashDrawer={key === 'customer'}
                systemPrinters={systemPrinters}
              />
              <div className="flex-row">
                <button className="btn primary" disabled={savingTarget === key} onClick={() => save(key)}>
                  {savingTarget === key ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
                <button className="btn info" disabled={!cfg.enabled} onClick={() => test(key)}>
                  Test Yazdır
                </button>
              </div>
            </div>
          );
        })}

        {Object.values(extraPrinters).map((cfg) => (
          <div className="settings-card" key={cfg.id}>
            <h3>{cfg.name} <span className="muted" style={{ fontSize: 12 }}>(ek)</span></h3>
            <div>
              <label className="label">Görünen Ad</label>
              <input
                className="input"
                value={cfg.name}
                onChange={(e) => updateExtra(cfg.id, { name: e.target.value })}
              />
            </div>
            <PrinterFields
              cfg={cfg}
              onChange={(patch) => updateExtra(cfg.id, patch)}
              systemPrinters={systemPrinters}
            />
            <div className="flex-row">
              <button className="btn primary" disabled={savingTarget === cfg.id} onClick={() => saveExtra(cfg.id)}>
                {savingTarget === cfg.id ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
              <button className="btn info" disabled={!cfg.enabled} onClick={() => testExtra(cfg.id)}>
                Test Yazdır
              </button>
              <button className="btn danger" onClick={() => deleteExtra(cfg.id)}>
                Sil
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="settings-card" style={{ maxWidth: 600, marginTop: 24 }}>
        <h3>Yeni Yazıcı Ekle</h3>
        <div className="flex-row">
          <input
            className="input"
            placeholder="Örn: Pizza, Bar, Tatlı"
            value={newPrinterName}
            onChange={(e) => setNewPrinterName(e.target.value)}
          />
          <button className="btn primary" onClick={addExtra}>Ekle</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Ek bir mutfak/bar yazıcısı tanımlayın; ardından kategorileri buna yönlendirin.
        </div>
      </div>

      <div className="settings-card" style={{ maxWidth: 600, marginTop: 24 }}>
        <h3>Kategori → Yazıcı Yönlendirme</h3>
        {categories.length === 0 ? (
          <div className="muted">Henüz kategori tanımlanmamış.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Kategori</th>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Yazıcı</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat}>
                  <td style={{ padding: '6px 4px' }}>{cat}</td>
                  <td style={{ padding: '6px 4px' }}>
                    <select
                      className="input"
                      value={routing[cat] ?? ''}
                      onChange={(e) => updateRouting(cat, e.target.value)}
                    >
                      {printerOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={saveRouting}>Yönlendirmeleri Kaydet</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Bir kategori için yazıcı seçilmezse o kategorideki ürünler <b>Mutfak Yazıcısı (Varsayılan)</b>'na gönderilir.
        </div>
      </div>

      <div className="shortcuts">
        <h3>Klavye Kısayolları</h3>
        <ul>
          <li><b>Enter</b> — Sepeti mutfağa gönder</li>
          <li><b>P</b> — Müşteri fişini yazdır</li>
          <li><b>K</b> — Son mutfak siparişini yeniden yazdır</li>
          <li><b>Esc</b> — Masalar ekranına dön</li>
        </ul>
      </div>
    </>
  );
};
