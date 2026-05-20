import React from 'react';

interface Props {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
  confirmDisabled?: boolean;
}

export const ConfirmModal: React.FC<Props> = ({
  open,
  title,
  message,
  confirmLabel = 'Onayla',
  cancelLabel = 'İptal',
  destructive,
  onConfirm,
  onCancel,
  children,
  confirmDisabled = false,
}) => {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {message && <p className="muted">{message}</p>}
        {children}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn ${destructive ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
