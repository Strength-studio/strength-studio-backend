'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

export function OnboardingFlow({ step }: { step: 'setup' | 'verify' | 'password' }) {
  const proof = useRef(''), passwordFlow = useRef(''), active = useRef(true), transport = useRef(new AbortController());
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [doneAction, setDoneAction] = useState(''), [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const done = !!doneAction;
  useEffect(() => {
    active.current = true;
    if (transport.current.signal.aborted) transport.current = new AbortController();
    const value = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
    // A StrictMode remount may see the already-cleared fragment. Preserve only in memory.
    if (value) proof.current = value;
    // Only a non-secret correlation ID is retained in this tab's history entry,
    // allowing reload without selecting another tab's HttpOnly credential.
    const flowId = new URLSearchParams(location.hash.slice(1)).get('flow') ?? history.state?.onboardingPasswordFlow;
    if (step === 'password' && typeof flowId === 'string' && /^[A-Za-z0-9_-]{32}$/.test(flowId)) passwordFlow.current = flowId;
    history.replaceState({ ...history.state, ...(passwordFlow.current ? { onboardingPasswordFlow: passwordFlow.current } : {}) }, '', location.pathname);
    setReady(true);
    const conceal = () => { proof.current = ''; passwordFlow.current = ''; transport.current.abort();
      document.querySelector('.onboarding-public')?.setAttribute('hidden', '');
      document.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(input => { input.value = ''; });
      setReady(false); };
    window.addEventListener('pagehide', conceal);
    const restore = (event: PageTransitionEvent) => { if (event.persisted) location.reload(); };
    window.addEventListener('pageshow', restore);
    return () => { active.current = false; transport.current.abort(); window.removeEventListener('pagehide', conceal); window.removeEventListener('pageshow', restore); };
  }, []);
  async function submit(action: string, body: object) {
    if (busy || !active.current) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const challenge = await fetch('/api/onboarding/csrf', { cache: 'no-store', signal: transport.current.signal });
      if (!challenge.ok) throw new Error();
      const { csrfToken } = await challenge.json();
      const response = await fetch('/api/onboarding/' + action, { method: 'POST', cache: 'no-store', signal: transport.current.signal,
        headers: { 'Content-Type': 'application/json', 'X-Onboarding-CSRF': csrfToken }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!active.current) return;
      if (!response.ok) {
        setError(result.code === 'INVALID_INPUT' ? 'Check your input. Passwords must contain 12–256 characters.'
          : result.code === 'CHALLENGE_INVALID_OR_EXPIRED' ? 'This authorization is invalid, used or expired. Request a fresh verification email, or ask Admin to reissue an unused setup link.'
            : 'Could not confirm the result. It may have completed. Try signing in after completion, or request a fresh verification email.');
        return;
      }
      if (action === 'resend') {
        setNotice('If this request is eligible, verification email delivery has been queued. Check your email.');
        return;
      }
      proof.current = '';
      if (action === 'verify') {
        if (typeof result.flowId !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(result.flowId)) throw new Error();
        location.assign('/setup-password#flow=' + result.flowId); return;
      }
      setDoneAction(action);
    } catch { if (active.current) setError('Could not confirm the result. Keep the link if unused, or request a fresh verification email.'); }
    finally { if (active.current) setBusy(false); }
  }
  function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    const value = data.get('password'); form.reset(); void submit('password', { password: value, flowId: passwordFlow.current });
  }
  return <main className="entry"><section className="panel entry-card onboarding-public" aria-busy={busy}>
    <h1>{step === 'setup' ? 'Start Client setup' : step === 'verify' ? 'Verify your email' : 'Set your password'}</h1>
    {!done && <p>{step === 'setup' ? 'Continue to request a separate verification email. Opening this link does not enable sign-in.'
      : step === 'verify' ? 'Confirm ownership of this email address, then choose your password.' : 'Choose a password of 12–256 characters. Your account becomes active after this step.'}</p>}
    {!done && step !== 'password' && <button className="button primary" disabled={!ready || busy || !proof.current}
      onClick={() => void submit(step === 'setup' ? 'accept' : 'verify', { token: proof.current })}>{step === 'setup' ? 'Send verification email' : 'Verify email'}</button>}
    {!done && step === 'password' && <form onSubmit={password}>
      <label>New password<input name="password" type="password" minLength={12} maxLength={256} autoComplete="new-password" required disabled={!ready || busy} /></label>
      <button className="button primary" disabled={!ready || busy}>Complete setup</button>
    </form>}
    {done && <p role="status">{doneAction === 'password' ? 'Your account is active. Sign in to continue.' : 'If this request is eligible, verification email delivery has been queued. Check your email.'}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <a className="button quiet" href="/">Sign in</a>
    {step !== 'password' && <p>A used or expired email proof can be replaced below. An expired unused setup link requires Admin reissue.</p>}
    <form aria-label="Request verification email" onSubmit={event => {
      event.preventDefault(); const email = new FormData(event.currentTarget).get('email'); void submit('resend', { email });
    }}>
      <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} disabled={!ready || busy} /></label>
      <button className="button secondary" disabled={!ready || busy}>Request verification email</button>
    </form>
  </section></main>;
}
