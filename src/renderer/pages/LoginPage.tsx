import React, { useState } from 'react';
import { authApi } from '../firebase/auth';
import { toastError } from '../components/Toast';

const getAuthErrorMessage = (err: unknown): string => {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: string }).code;
    switch (code) {
      case 'auth/network-request-failed':
        return 'Ağ bağlantısı hatası. İnternet bağlantınızı kontrol edin.';
      case 'auth/too-many-requests':
        return 'Çok fazla başarısız deneme. Lütfen daha sonra tekrar deneyin.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'E-posta veya şifre hatalı.';
      case 'auth/user-disabled':
        return 'Bu hesap devre dışı bırakıldı.';
      case 'auth/operation-not-allowed':
        return 'E-posta/şifre girişi devre dışı. Firebase konsolunu kontrol edin.';
      default:
        return `Giriş başarısız (${code}).`;
    }
  }
  return 'Giriş başarısız. Bilgileri kontrol edin.';
};

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await authApi.signIn(email.trim(), password);
    } catch (err) {
      console.error(err);
      toastError(getAuthErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h2>Restaurant Finance</h2>
        <p className="muted center">Hesabınızla giriş yapın</p>
        <div>
          <label className="label">E-posta</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </div>
        <div>
          <label className="label">Şifre</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="btn primary large block" type="submit" disabled={busy}>
          {busy ? 'Giriş yapılıyor…' : 'Giriş Yap'}
        </button>
      </form>
    </div>
  );
};
