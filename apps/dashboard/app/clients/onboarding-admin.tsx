'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { dateTime } from '../../lib/catalog';

type Status = { status: string; revision?: number; expiresAt?: string | null; canReissueAt?: string | null; delivery?: string | null };
type Intent = { path: string; body: string; key: string };
export function OnboardingAdmin({ actorId, clientId }: { actorId: string; clientId?: string }) {
  const [status, setStatus] = useState<Status>(), [ready, setReady] = useState(false), [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [link, setLink] = useState(''), [expires, setExpires] = useState(''), [created, setCreated] = useState(clientId);
  const [confirm, setConfirm] = useState<'reissue' | 'revoke'>(), [reason, setReason] = useState(''), [clock, setClock] = useState(Date.now());
  const [displayName, setDisplayName] = useState(''), [email, setEmail] = useState('');
  const target = useRef(clientId), intent = useRef<Intent | null>(null), controller = useRef(new AbortController()), active = useRef(true);
  function invalidate() {
    active.current = false; controller.current.abort(); intent.current = null;
    setLink(''); setStatus(undefined); setPending(false); setDenied(true);
    setDisplayName(''); setEmail(''); setReason(''); setConfirm(undefined);
  }
  async function read(path: string, options: RequestInit = {}) {
    const current = controller.current;
    const response = await fetch(path, { ...options, cache: 'no-store', signal: current.signal });
    const body = response.status === 204 ? null : await response.json();
    if (!active.current || current !== controller.current) throw new Error('ABORTED');
    if (response.status === 401 || response.status === 403) { invalidate(); throw new Error('ABORTED'); }
    if (!response.ok) throw new Error(body?.code ?? 'DASHBOARD_UNAVAILABLE');
    return body;
  }
  async function identity() {
    const actor = await read('/api/studio/v1/me');
    if (actor.id !== actorId || actor.role !== 'ADMIN') { invalidate(); throw new Error('ABORTED'); }
  }
  async function refresh() {
    await identity();
    if (target.current) setStatus(await read('/api/studio/v1/clients/' + target.current + '/onboarding'));
  }
  useEffect(() => {
    active.current = true;
    if (controller.current.signal.aborted) controller.current = new AbortController();
    const check = () => {
      controller.current.abort(); controller.current = new AbortController();
      const current = controller.current;
      setLink(''); setReady(false); setBusy(false);
      if (document.visibilityState !== 'visible') return;
      void refresh().then(() => { if (active.current && current === controller.current) setReady(true); })
        .catch(() => { if (active.current && current === controller.current) setError('Could not verify access. Reload this page.'); });
    };
    check();
    const timer = setInterval(() => setClock(Date.now()), 1000);
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    window.addEventListener('pagehide', check);
    return () => { active.current = false; controller.current.abort(); intent.current = null; clearInterval(timer);
      window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); window.removeEventListener('pagehide', check); };
  }, []);
  async function send(path?: string, body?: object) {
    if (busy || !active.current) return;
    setBusy(true); setError(''); setLink('');
    const current = controller.current;
    try {
      await identity();
      if (!intent.current && path && body) intent.current = { path, body: JSON.stringify(body), key: crypto.randomUUID() };
      const original = intent.current;
      if (!original) return;
      setPending(true);
      const { csrfToken } = await read('/api/session/csrf');
      const result = await read('/api/studio/v1/' + original.path, { method: 'POST', body: original.body,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': original.key, 'X-Studio-Actor': actorId, 'X-CSRF-Token': csrfToken } });
      intent.current = null; setPending(false); setConfirm(undefined); setReason('');
      if (result?.clientId) {
        setDisplayName(''); setEmail('');
        target.current = result.clientId; setCreated(result.clientId); setExpires(result.expiresAt);
        setLink(result.setupLink ?? '');
        if (!result.setupLink) setError('The original request succeeded. Its link cannot be shown again; review the record and explicitly reissue if needed.');
      }
      await refresh();
    } catch (cause) {
      if (active.current && current === controller.current) {
        const code = cause instanceof Error ? cause.message : 'DASHBOARD_UNAVAILABLE';
        if (['INVALID_INPUT', 'CLIENT_IDENTITY_CONFLICT', 'ONBOARDING_CHANGED', 'ONBOARDING_NOT_ELIGIBLE', 'ONBOARDING_RATE_LIMITED',
          'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_EXPIRED'].includes(code)) { intent.current = null; setPending(false); }
        setError(({ CLIENT_IDENTITY_CONFLICT: 'This identity already exists. Review the existing Client; no account was linked or changed.',
          ONBOARDING_RATE_LIMITED: 'Wait at least 60 seconds between reissues. At most five replacements per hour are allowed.',
          ONBOARDING_CHANGED: 'Onboarding changed. Refresh and review the latest state.',
          ONBOARDING_NOT_ELIGIBLE: 'This onboarding can no longer perform that action.' } as Record<string, string>)[code]
          ?? 'The result could not be confirmed. Keep this page open and retry the original request.');
      }
    } finally { if (active.current && current === controller.current) setBusy(false); }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void send('users/invite', { email: data.get('email'), displayName: data.get('displayName') });
  }
  if (denied) return <p role="alert" className="notice error">Your account or access changed. Sign in again.</p>;
  if (!ready) return <section className="panel onboarding-admin"><p role="status">Checking onboarding access…</p>{error && <p role="alert">{error}</p>}</section>;
  const ongoing = status && !['NOT_STARTED', 'COMPLETED', 'REVOKED', 'DISABLED'].includes(status.status);
  return <section className="panel onboarding-admin" aria-busy={busy}>
    <h2>{target.current ? 'Client onboarding' : 'Invite a Client'}</h2>
    <p>Share the initial setup link manually. The Client must verify their email separately and set a password before sign-in.</p>
    {!created && <form onSubmit={create}>
      <label>Client name<input name="displayName" value={displayName} onChange={event => setDisplayName(event.target.value)} required maxLength={120} disabled={busy || pending} /></label>
      <label>Email<input name="email" type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} disabled={busy || pending} autoComplete="off" /></label>
      <button className="button primary" disabled={busy || pending}>Create invitation</button>
    </form>}
    {created && <p><a href={'/clients/' + created}>Open Client profile</a></p>}
    {status && <p role="status">{({ NOT_STARTED: 'No onboarding started', INVITED: 'Invited — manual link pending', VERIFY_EMAIL: 'Email verification pending',
      SET_PASSWORD: 'Email verified — password setup pending', COMPLETED: 'Onboarding completed', REVOKED: 'Onboarding revoked', DISABLED: 'Account disabled' } as Record<string, string>)[status.status]}</p>}
    {status?.delivery && <p>Email delivery: {status.delivery.toLowerCase()}. Delivery does not verify email ownership.</p>}
    {status?.expiresAt && <p>Current step expires (Riyadh): {dateTime(status.expiresAt)}</p>}
    {link && <div className="notice info" role="group" aria-label="Manual setup link">
      <p>This link is shown once. Copy it for manual sharing before leaving this page. Expires (Riyadh): {dateTime(expires)}.</p>
      <label>Setup link<input value={link} readOnly onFocus={event => event.currentTarget.select()} /></label>
      <button className="button secondary" onClick={() => { void navigator.clipboard?.writeText(link).catch(() => setError('Select the setup link and copy it manually.')); }}>Copy setup link</button>
      <button className="button quiet" onClick={() => setLink('')}>Hide setup link</button>
    </div>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {pending && <button className="button primary" disabled={busy} onClick={() => void send()}>Retry original request</button>}
    {target.current && <div className="button-row">
      <button className="button secondary" disabled={busy} onClick={() => { setLink(''); void refresh().catch(() => setError('Could not refresh onboarding.')); }}>Refresh onboarding</button>
      {status?.status === 'INVITED' && <button className="button secondary" disabled={busy || pending || !!confirm || (!!status.canReissueAt && Date.parse(status.canReissueAt) > clock)} onClick={() => setConfirm('reissue')}>Reissue setup link</button>}
      {ongoing && <button className="button secondary" disabled={busy || pending || !!confirm} onClick={() => setConfirm('revoke')}>Revoke onboarding</button>}
    </div>}
    {confirm && <form aria-label={'Confirm ' + confirm} onSubmit={event => {
      event.preventDefault(); void send('users/' + target.current + '/onboarding/' + confirm, { expectedRevision: status?.revision, reason });
    }}>
      <p>{confirm === 'reissue' ? 'The previous link will stop working.' : 'All unfinished setup, email and password authorizations will stop working.'}</p>
      <label>Reason<input name="reason" value={reason} onChange={event => setReason(event.target.value)} required maxLength={500} disabled={busy || pending} /></label>
      <button className="button primary" disabled={busy || pending}>Confirm {confirm}</button>
      <button type="button" className="button quiet" disabled={busy || pending} onClick={() => setConfirm(undefined)}>Cancel</button>
    </form>}
  </section>;
}
