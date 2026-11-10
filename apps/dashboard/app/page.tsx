'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { Account } from '../lib/catalog';
import { CatalogDashboard } from './catalog/dashboard';
import { Icon } from './catalog/ui';

export default function Home() {
  const [account, setAccount] = useState<Account>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const expired = useCallback(() => {
    setAccount(undefined);
    setMessage('Your session expired. Sign in or restore your session.');
  }, []);

  async function readAccount() {
    const response = await fetch('/api/studio/v1/me', { cache: 'no-store' });
    setAccount(response.ok ? await response.json() : undefined);
    return response.status;
  }

  useEffect(() => {
    void readAccount().catch(() => setMessage('The API is unavailable.'));
  }, []);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      if (navigator.locks) await navigator.locks.request('strength-studio-session', operation);
      else await operation();
    } catch {
      setMessage('Could not complete the request. Check the local services and try again.');
    } finally {
      setBusy(false);
    }
  }

  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = JSON.stringify({ email: data.get('email'), password: data.get('password') });
    form.reset();
    void run(async () => {
      const response = await fetch('/api/session/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      if (response.ok) await readAccount();
      else setMessage('Sign-in failed.');
    });
  }

  function sessionAction(action: 'refresh' | 'logout') {
    if (action === 'refresh' && !navigator.locks) {
      setMessage('Sign in again to renew the session in this browser.');
      return;
    }
    void run(async () => {
      // A different tab may have already renewed the cookie while this tab waited.
      if (action === 'refresh' && await readAccount() === 200) {
        setMessage('Your session is active.');
        return;
      }
      const challenge = await fetch('/api/session/csrf', { cache: 'no-store' });
      if (!challenge.ok) { setAccount(undefined); setMessage('Sign in again.'); return; }
      const { csrfToken } = await challenge.json();
      const response = await fetch(`/api/session/${action}`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
      if (!response.ok) setMessage('Could not update the session. You may need to sign in again.');
      await readAccount();
    });
  }

  if (account && ['ADMIN', 'STAFF'].includes(account.role)) {
    return <CatalogDashboard key={account.id} account={account} busy={busy} sessionNotice={message}
      onSignOut={() => sessionAction('logout')} onExpired={expired} />;
  }

  return <main className="entry">
    <section className="panel entry-card">
      <div className="brand"><span className="brand-mark"><Icon name="layers" size={24} /></span>
        <div><strong>Strength Studio</strong><span>Studio operations</span></div></div>
      <h1>{account ? 'You’re signed in' : 'Sign in to the studio'}</h1>
      {account ? <>
        <p className="muted">Signed in as {account.email} ({account.role}). This account has no catalog management workspace.</p>
        <button className="button secondary" type="button" disabled={busy} onClick={() => sessionAction('logout')}>Sign out</button>
      </> : <form onSubmit={login}>
        <label>Email<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="button primary" disabled={busy}>{busy ? 'Working…' : 'Sign in'}</button>
      </form>}
      <button className="button quiet" type="button" disabled={busy} onClick={() => sessionAction('refresh')}>Restore existing session</button>
      {message && <p className="muted" role="status">{message}</p>}
    </section>
  </main>;
}
