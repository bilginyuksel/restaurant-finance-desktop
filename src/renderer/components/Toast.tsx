import React, { useEffect, useState } from 'react';

interface ToastMessage {
  id: number;
  text: string;
  kind?: 'success' | 'error' | 'info';
}

let push: (m: Omit<ToastMessage, 'id'>) => void = () => undefined;

export const toast = (text: string, kind: ToastMessage['kind'] = 'info') => push({ text, kind });
export const toastError = (text: string) => push({ text, kind: 'error' });
export const toastSuccess = (text: string) => push({ text, kind: 'success' });

export const ToastHost: React.FC = () => {
  const [items, setItems] = useState<ToastMessage[]>([]);

  useEffect(() => {
    push = (m) => {
      const id = Date.now() + Math.random();
      setItems((s) => [...s, { ...m, id }]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 3500);
    };
    return () => { push = () => undefined; };
  }, []);

  return (
    <>
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind ?? ''}`}>{t.text}</div>
      ))}
    </>
  );
};
