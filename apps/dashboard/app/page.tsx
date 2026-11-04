'use client';

import { FormEvent, useEffect, useState } from 'react';

type Account = { email: string; role: string };

export default function Home() {
  const [account, setAccount] = useState<Account>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

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

  return <main>
    <h1>Strength Studio</h1>
    <p>Foundation sign-in</p>
    {account ? <>
      <p>Signed in as {account.email} ({account.role})</p>
      <button type="button" disabled={busy} onClick={() => sessionAction('logout')}>Sign out</button>
    </> : <form onSubmit={login}>
      <label>Email <input name="email" type="email" autoComplete="username" required /></label>{' '}
      <label>Password <input name="password" type="password" autoComplete="current-password" required /></label>{' '}
      <button disabled={busy}>Sign in</button>
    </form>}
    <button type="button" disabled={busy} onClick={() => sessionAction('refresh')}>Restore existing session</button>
    <p role="status">{message}</p>
  </main>;
}
