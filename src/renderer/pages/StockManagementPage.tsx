import React, { useState, useEffect } from "react";
import { useFinance } from "../context/FinanceContext";
import { ConfirmModal } from "../components/ConfirmModal";
import { toastError, toastSuccess } from "../components/Toast";
import { Stock, StockMovement, Warehouse } from "../../shared/types";
import { formatCurrency } from "../utils/currency";

const newId = () =>
  `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const StockManagementPage: React.FC = () => {
  const {
    warehouses,
    stocks,
    recipes,
    addWarehouse,
    updateWarehouse,
    deleteWarehouse,
    updateStock,
    addStock,
    recordStockMovement,
    userProfile,
  } = useFinance();
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (warehouses.length > 0 && !selectedWarehouseId) {
      setSelectedWarehouseId(warehouses[0].id);
    }
  }, [warehouses, selectedWarehouseId]);

  const [warehouseModal, setWarehouseModal] = useState<{
    id?: string;
    name: string;
  } | null>(null);
  const [stockModal, setStockModal] = useState<{
    productId: string;
    currentQuantity: number;
    adjustment: string;
    reason: string;
    transferWarehouseId?: string;
  } | null>(null);

  const activeWarehouse = warehouses.find((w) => w.id === selectedWarehouseId);
  const activeStocks = stocks.filter(
    (s) => s.warehouseId === selectedWarehouseId,
  );

  const handleSaveWarehouse = async () => {
    if (!warehouseModal || !warehouseModal.name.trim()) return;
    try {
      if (warehouseModal.id) {
        await updateWarehouse({
          ...warehouses.find((w) => w.id === warehouseModal.id)!,
          name: warehouseModal.name.trim(),
        });
        toastSuccess("Depo güncellendi");
      } else {
        const newWarehouse = {
          id: newId(),
          name: warehouseModal.name.trim(),
          location: "",
        };
        await addWarehouse(newWarehouse);
        setSelectedWarehouseId(newWarehouse.id);
        toastSuccess("Depo eklendi");
      }
      setWarehouseModal(null);
    } catch (err) {
      toastError("Depo kaydedilemedi");
    }
  };

  const handleDeleteWarehouse = async (id: string) => {
    if (!window.confirm("Bu depoyu silmek istediğinize emin misiniz?")) return;
    try {
      await deleteWarehouse(id);
      if (selectedWarehouseId === id)
        setSelectedWarehouseId(
          warehouses.length > 1
            ? warehouses.filter((w) => w.id !== id)[0].id
            : null,
        );
      toastSuccess("Depo silindi");
    } catch (err) {
      toastError("Depo silinemedi");
    }
  };

  const handleSaveStock = async () => {
    if (!stockModal || !selectedWarehouseId) return;
    const adjust = parseFloat(stockModal.adjustment.replace(",", "."));
    if (isNaN(adjust) || adjust === 0) {
      toastError("Geçerli bir miktar girin");
      return;
    }

    // Permission check for non-transfer
    if (
      stockModal.reason !== "transfer" &&
      userProfile?.email !== "kaan@gmail.com"
    ) {
      toastError("Bu işlem için yetkiniz yok.");
      return;
    }

    try {
      if (stockModal.reason === "transfer") {
        // Transfer: decrease from current warehouse, increase in selected warehouse
        if (
          !stockModal.transferWarehouseId ||
          stockModal.transferWarehouseId === selectedWarehouseId
        ) {
          toastError("Lütfen farklı bir hedef depo seçin.");
          return;
        }
        // Decrease from current warehouse
        const existingStock = activeStocks.find(
          (s) => s.productId === stockModal.productId,
        );
        if (!existingStock || existingStock.quantity < adjust) {
          toastError("Yeterli stok yok.");
          return;
        }
        await updateStock({
          ...existingStock,
          quantity: existingStock.quantity - adjust,
          lastUpdated: new Date().toISOString(),
        });
        await recordStockMovement({
          id: newId(),
          warehouseId: selectedWarehouseId,
          productId: stockModal.productId,
          quantityChange: -adjust,
          reason: "transfer",
          referenceId: "stock_transfer",
        });
        // Increase in target warehouse
        const targetStocks = stocks.filter(
          (s) => s.warehouseId === stockModal.transferWarehouseId,
        );
        const targetStock = targetStocks.find(
          (s) => s.productId === stockModal.productId,
        );
        if (targetStock) {
          await updateStock({
            ...targetStock,
            quantity: targetStock.quantity + adjust,
            lastUpdated: new Date().toISOString(),
          });
        } else {
          await addStock({
            id: newId(),
            warehouseId: stockModal.transferWarehouseId,
            productId: stockModal.productId,
            quantity: adjust,
            lastUpdated: new Date().toISOString(),
          });
        }
        await recordStockMovement({
          id: newId(),
          warehouseId: stockModal.transferWarehouseId,
          productId: stockModal.productId,
          quantityChange: adjust,
          reason: "transfer",
          referenceId: "stock_transfer",
        });
        toastSuccess("Transfer işlemi başarılı");
        setStockModal(null);
        return;
      }

      // Other operations (manual, delivery, etc.)
      const existingStock = activeStocks.find(
        (s) => s.productId === stockModal.productId,
      );
      if (existingStock) {
        await updateStock({
          ...existingStock,
          quantity: existingStock.quantity + adjust,
          lastUpdated: new Date().toISOString(),
        });
      } else {
        await addStock({
          id: newId(),
          warehouseId: selectedWarehouseId,
          productId: stockModal.productId,
          quantity: adjust,
          lastUpdated: new Date().toISOString(),
        });
      }

      await recordStockMovement({
        id: newId(),
        warehouseId: selectedWarehouseId,
        productId: stockModal.productId,
        quantityChange: adjust,
        reason: (stockModal.reason as any) || "manual",
        referenceId: "manual_adjustment",
      });

      toastSuccess("Stok güncellendi");
      setStockModal(null);
    } catch (err) {
      toastError("Stok güncellenemedi");
    }
  };

  return (
    <div
      className="reports-page flex-row"
      style={{ alignItems: "flex-start", gap: 24 }}
    >
      {/* Sidebar for Warehouses */}
      <div
        className="reports-sidebar"
        style={{
          width: 250,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <div>
          <div className="flex-row" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0 }}>Depolar</h2>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {warehouses.map((w) => (
              <div
                key={w.id}
                className={`btn ${selectedWarehouseId === w.id ? "primary" : "outline"}`}
                style={{
                  textAlign: "left",
                  justifyContent: "space-between",
                  display: "flex",
                  alignItems: "center",
                  padding: "8px 16px",
                  cursor: "pointer",
                }}
                onClick={() => setSelectedWarehouseId(w.id)}
              >
                <span>{w.name}</span>
                {userProfile?.email === "kaan@gmail.com" && (
                  <div className="flex-row" style={{ gap: 4 }}>
                    <button
                      style={{
                        color:
                          selectedWarehouseId === w.id
                            ? "white"
                            : "var(--text)",
                        opacity: 0.8,
                        padding: "2px 6px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 14,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setWarehouseModal({ id: w.id, name: w.name });
                      }}
                    >
                      ✎
                    </button>
                    <button
                      style={{
                        color:
                          selectedWarehouseId === w.id
                            ? "#ffcccc"
                            : "var(--danger)",
                        opacity: 0.8,
                        padding: "2px 6px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 16,
                        lineHeight: 1,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteWarehouse(w.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {userProfile?.email === "kaan@gmail.com" && (
            <button
              className="btn outline"
              style={{ width: "100%", marginTop: 16 }}
              onClick={() => setWarehouseModal({ name: "" })}
            >
              + Yeni Depo Ekle
            </button>
          )}
        </div>
      </div>

      {/* Main content for Stock List */}
      <div
        className="reports-content"
        style={{ flex: 1, display: "flex", flexDirection: "column", gap: 24 }}
      >
        {warehouses.length === 0 ? (
          <div className="empty-state">
            <p>Henüz kayıtlı depo bulunmuyor.</p>
            <button
              className="btn primary"
              onClick={() => setWarehouseModal({ name: "" })}
            >
              Depo Ekle
            </button>
          </div>
        ) : (
          <>
            <div className="flex-row">
              <h2 style={{ margin: 0 }}>
                Stok Yönetimi: {activeWarehouse?.name}
              </h2>
            </div>

            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr
                    style={{
                      background: "var(--surface-2)",
                      textAlign: "left",
                    }}
                  >
                    <th
                      style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      Ürün
                    </th>
                    <th
                      style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      Mevcut Miktar
                    </th>
                    <th
                      style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid var(--border)",
                        width: 120,
                      }}
                    >
                      İşlem
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recipes
                    .filter((r) => r.trackStock !== false)
                    .map((product) => {
                      const stock = activeStocks.find(
                        (s) => s.productId === product.id,
                      );
                      const qty = stock?.quantity || 0;
                      return (
                        <tr
                          key={product.id}
                          style={{ borderBottom: "1px solid var(--border)" }}
                        >
                          <td style={{ padding: "12px 16px" }}>
                            {product.name}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              fontWeight: "bold",
                              color: qty <= 0 ? "var(--danger)" : "inherit",
                            }}
                          >
                            {qty.toFixed(2)}{" "}
                            {product.pricingType === "by_weight"
                              ? "kg"
                              : "adet"}
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <button
                              className="btn small"
                              onClick={() => {
                                if (userProfile?.email === "kaan@gmail.com") {
                                  setStockModal({
                                    productId: product.id,
                                    currentQuantity: qty,
                                    adjustment: "",
                                    reason: "manual",
                                  });
                                } else {
                                  setStockModal({
                                    productId: product.id,
                                    currentQuantity: qty,
                                    adjustment: "",
                                    reason: "transfer",
                                    transferWarehouseId: "",
                                  });
                                }
                              }}
                            >
                              Stok Ekle/Çıkar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Warehouse Modal */}
      <ConfirmModal
        open={!!warehouseModal}
        title={warehouseModal?.id ? "Depoyu Düzenle" : "Yeni Depo"}
        confirmLabel="Kaydet"
        onConfirm={handleSaveWarehouse}
        onCancel={() => setWarehouseModal(null)}
      >
        <label className="label">Depo Adı</label>
        <input
          className="input"
          value={warehouseModal?.name || ""}
          onChange={(e) =>
            setWarehouseModal((m) =>
              m ? { ...m, name: e.target.value } : null,
            )
          }
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSaveWarehouse();
          }}
        />
      </ConfirmModal>

      {/* Stock Modal */}
      <ConfirmModal
        open={!!stockModal}
        title="Stok İşlemi"
        confirmLabel="Kaydet"
        onConfirm={handleSaveStock}
        onCancel={() => setStockModal(null)}
        confirmDisabled={
          !!stockModal &&
          stockModal.reason !== "transfer" &&
          userProfile?.email !== "kaan@gmail.com"
        }
      >
        {stockModal && (
          <>
            <div style={{ marginBottom: 16 }}>
              <strong>Ürün:</strong>{" "}
              {recipes.find((r) => r.id === stockModal.productId)?.name}
              <br />
              <strong>Mevcut:</strong> {stockModal.currentQuantity.toFixed(2)}
            </div>

            <label className="label">
              Değişim Miktarı (Ekleme için pozitif, çıkarma için negatif)
            </label>
            <input
              className="input"
              type="number"
              step="any"
              value={stockModal.adjustment}
              onChange={(e) =>
                setStockModal((m) =>
                  m ? { ...m, adjustment: e.target.value } : null,
                )
              }
              autoFocus
              placeholder="Örn: 10 veya -5"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveStock();
              }}
            />

            <label className="label" style={{ marginTop: 12 }}>
              İşlem Nedeni
            </label>
            <select
              className="input"
              value={stockModal.reason}
              onChange={(e) => {
                const val = e.target.value;
                setStockModal((m) => (m ? { ...m, reason: val } : null));
              }}
            >
              {userProfile?.email === "kaan@gmail.com" ? (
                <>
                  <option value="manual">Manuel Düzeltme</option>
                  <option value="delivery">Teslimat / Giriş</option>
                  <option value="transfer">Transfer</option>
                  <option value="loss">Fire / Kayıp</option>
                  <option value="adjustment">Sayım Düzeltmesi</option>
                </>
              ) : (
                <option value="transfer">Transfer</option>
              )}
            </select>

            {/* Warehouse selection for transfer */}
            {stockModal.reason === "transfer" && (
              <>
                <label className="label" style={{ marginTop: 12 }}>
                  Hedef Depo
                </label>
                <select
                  className="input"
                  value={stockModal.transferWarehouseId || ""}
                  onChange={(e) =>
                    setStockModal((m) =>
                      m ? { ...m, transferWarehouseId: e.target.value } : null,
                    )
                  }
                >
                  <option value="">Depo Seçin</option>
                  {warehouses
                    .filter((w) => w.id !== selectedWarehouseId)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
              </>
            )}

            {/* Permission warning for non-transfer */}
            {stockModal &&
              stockModal.reason !== "transfer" &&
              userProfile?.email !== "kaan@gmail.com" && (
                <div style={{ color: "var(--danger)", marginTop: 12 }}>
                  Bu işlem için yetkiniz yok.
                </div>
              )}
          </>
        )}
      </ConfirmModal>
    </div>
  );
};
