'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CatalogError, CatalogWrite, dateTime, get, newWrite } from '../../lib/catalog';
import { ClientStateBadge } from './ui';

type Profile = { id: string; displayName: string; email: string; accountState: 'ACTIVE' | 'INVITED' | 'PENDING_VERIFICATION' | 'DISABLED';
  emailVerifiedAt: string | null; createdAt: string };

export function ClientProfileEditor({ initial, actorId, admin }: { initial: Profile; actorId: string; admin: boolean }) {
  const [denied, setDenied] = useState(false);
  if (denied) return <p role="alert" className="notice error">Your session or access changed. Return to the dashboard and sign in again.</p>;
  return <ProfileWorkflow initial={initial} actorId={actorId} admin={admin} onDenied={() => setDenied(true)} />;
}

function ProfileWorkflow({ initial, actorId, admin, onDenied }: {
  initial: Profile; actorId: string; admin: boolean; onDenied: () => void;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initial), [name, setName] = useState(initial.displayName);
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<'profile' | 'disable' | null>(null), [conflict, setConflict] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  // The draft keeps the exact name it was based on, independently of refreshed server data.
  const draft = useRef({ name: initial.displayName, expectedDisplayName: initial.displayName });
  const intent = useRef<CatalogWrite | null>(null), active = useRef(true), inFlight = useRef(false);
  const transport = useRef(new AbortController());

  function dirty() { return draft.current.name !== draft.current.expectedDisplayName; }
  function resetDraft(displayName: string) {
    draft.current = { name: displayName, expectedDisplayName: displayName }; setName(displayName);
  }
  function invalidate() {
    active.current = false; transport.current.abort(); intent.current = null;
    onDenied();
  }
  async function current<T>(run: (signal: AbortSignal) => Promise<T>) {
    const controller = transport.current;
    const result = await run(controller.signal);
    if (!active.current || controller !== transport.current) throw new Error('WORKSPACE_INVALIDATED');
    return result;
  }
  async function checkIdentity() {
    const account = await current(signal => get<{ id: string; role: string }>('me', signal));
    if (account.id !== actorId || (admin && account.role !== 'ADMIN')) {
      invalidate(); throw new Error('WORKSPACE_INVALIDATED');
    }
  }
  function failed(cause: unknown) {
    if (!active.current) return;
    if (cause instanceof CatalogError && (cause.status === 401 || (cause.status === 403 && cause.code === 'FORBIDDEN'))) {
      invalidate(); return;
    }
    if (cause instanceof CatalogError && cause.code === 'CLIENT_PROFILE_CHANGED') {
      intent.current = null; setPending(null); setConflict(true);
      setError('This profile changed. Refresh the profile and review its current name before editing again.');
    } else {
      if (cause instanceof CatalogError && cause.status === 400) { intent.current = null; setPending(null); }
      setError(cause instanceof CatalogError && cause.status === 400 ? 'Check the display name and try again.'
        : 'The result could not be confirmed. Refresh to review the current profile, or retry the original request.');
    }
  }
  async function run(task: () => Promise<void>, preserveFeedback = false) {
    if (inFlight.current || !active.current) return;
    const controller = transport.current;
    inFlight.current = true; setBusy(true);
    if (!preserveFeedback) { setError(''); setNotice(''); }
    try { await task(); } catch (cause) { if (controller === transport.current) failed(cause); }
    finally { if (controller === transport.current) { inFlight.current = false; if (active.current) setBusy(false); } }
  }
  async function refresh(discardDraft = false) {
    await checkIdentity();
    const next = await current(signal => get<Profile>('clients/' + initial.id, signal));
    setProfile(next);
    // Automatic reads preserve dirty input and its precondition. An ambiguous write
    // always keeps its original body/key, even if refresh already sees its effect.
    if (!intent.current && (discardDraft || !dirty())) {
      resetDraft(next.displayName); setConflict(false);
    }
    setConfirmDisable(false);
  }
  function requestRefresh() {
    if (!intent.current && dirty()) { setConfirmRefresh(true); return; }
    void run(() => refresh(true));
  }
  async function send(kind: 'profile' | 'disable') {
    await checkIdentity();
    intent.current ??= kind === 'profile'
      ? newWrite('clients/' + profile.id, { displayName: draft.current.name.trim(), expectedDisplayName: draft.current.expectedDisplayName }, 'PATCH')
      : newWrite('users/' + profile.id + '/disable', {});
    setPending(kind);
    const original = intent.current;
    const { csrfToken } = await current(signal => fetch('/api/session/csrf', { cache: 'no-store', signal }).then(async res => {
      if (!res.ok) throw new CatalogError(res.status, 'UNAUTHENTICATED');
      return res.json();
    }));
    const response = await current(signal => fetch('/api/studio/v1/' + original.path, {
      method: original.method, body: original.body, cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, 'Idempotency-Key': original.key, 'X-Studio-Actor': actorId },
    }));
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new CatalogError(response.status, body.code ?? 'API_REQUEST_FAILED');
    }
    if (response.status !== 204) throw new Error('Unexpected write response');
    intent.current = null; setPending(null);
    if (kind === 'profile') {
      const savedName = (JSON.parse(original.body) as { displayName: string }).displayName;
      resetDraft(savedName); setProfile(previous => ({ ...previous, displayName: savedName })); setConflict(false);
    }
    await refresh();
    router.refresh();
    setNotice(kind === 'profile' ? 'Display name saved.' : 'Account access disabled. Memberships and commercial history are unchanged.');
  }
  useEffect(() => {
    active.current = true;
    setReady(true);
    if (transport.current.signal.aborted) transport.current = new AbortController();
    const revalidate = () => {
      if (document.visibilityState !== 'visible' || !active.current) return;
      // A tab/account change must not wait for an older protected response. A write may
      // already have committed, so retain its immutable intent for an explicit retry.
      transport.current.abort(); transport.current = new AbortController(); inFlight.current = false;
      setChecking(true);
      const controller = transport.current;
      void run(refresh, true).finally(() => { if (active.current && controller === transport.current) setChecking(false); });
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      active.current = false; transport.current.abort(); intent.current = null;
      window.removeEventListener('focus', revalidate); document.removeEventListener('visibilitychange', revalidate);
    };
  }, []);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[^\u0000-\u001f\u007f]{1,120}$/.test(name.trim())) { setError('Enter a display name of 1–120 characters without control characters.'); return; }
    void run(() => send('profile'));
  }

  return <div data-client-profile="" aria-busy={busy || !ready}>
    {checking && <p role="status">Checking current access…</p>}
    <div hidden={checking} className="client-profile-content">
      <header className="section-heading"><h1>{profile.displayName}</h1></header>
      <section className="panel client-summary" aria-labelledby="profile-heading">
        <h2 id="profile-heading">Account details</h2>
        <dl className="terms">
          <div><dt>Email</dt><dd>{profile.email}</dd></div>
          <div><dt>Account state</dt><dd><ClientStateBadge state={profile.accountState} /></dd></div>
          <div><dt>Email verified (Riyadh)</dt><dd>{profile.emailVerifiedAt
            ? <time dateTime={profile.emailVerifiedAt}>{dateTime(profile.emailVerifiedAt)}</time> : 'Unverified'}</dd></div>
          <div><dt>Created (Riyadh)</dt><dd><time dateTime={profile.createdAt}>{dateTime(profile.createdAt)}</time></dd></div>
        </dl>
      </section>
      {error && <p className="notice error" role="alert">{error}</p>}
      {notice && <p className="notice success" role="status">{notice}</p>}
      <button type="button" className="button secondary" disabled={busy || !ready || confirmRefresh} onClick={requestRefresh}>Refresh profile</button>
      {confirmRefresh && <div className="notice info" role="group" aria-label="Confirm profile refresh">
        <p>Discard unsaved display-name changes? Refreshing replaces your draft with the current saved name.</p>
        <div className="button-row">
          <button type="button" className="button secondary" disabled={busy} onClick={() => {
            setConfirmRefresh(false); void run(() => refresh(true));
          }}>Discard changes and refresh</button>
          <button type="button" className="button quiet" disabled={busy} onClick={() => setConfirmRefresh(false)}>Keep editing</button>
        </div>
      </div>}
      {admin && <section className="panel client-maintenance" aria-labelledby="maintenance-heading">
        <h2 id="maintenance-heading">Admin profile maintenance</h2>
        <form onSubmit={save}>
          <label>Display name<input name="displayName" aria-label="Display name" value={name} maxLength={120} required
            disabled={!ready || busy || !!pending || conflict || confirmRefresh} onChange={event => {
              draft.current.name = event.target.value; setName(event.target.value);
            }} /></label>
          <button className="button primary" disabled={!ready || busy || !!pending || conflict || confirmRefresh} type="submit">Save display name</button>
        </form>
        {pending && <p className="notice info">The request is retained for retry. Its values are locked until the outcome is confirmed.
          Leaving or reloading this page clears this retry checkpoint; review the current record before submitting again.</p>}
        {pending && <button type="button" className="button secondary" disabled={busy}
          onClick={() => void run(() => send(pending))}>Retry original request</button>}
        <p>Disabling account access revokes sign-in sessions. It does not cancel bookings, change Memberships or alter payment history.</p>
        {profile.accountState !== 'DISABLED' && <>
          <label className="client-disable-confirmation"><input type="checkbox" checked={confirmDisable} disabled={!ready || busy || !!pending || confirmRefresh}
            onChange={event => setConfirmDisable(event.target.checked)} /> I confirm disabling this Client’s account access.</label>
          <button type="button" className="button secondary" disabled={busy || !!pending || !confirmDisable || confirmRefresh}
            onClick={() => void run(() => send('disable'))}>Disable account access</button>
        </>}
      </section>}
    </div>
  </div>;
}
