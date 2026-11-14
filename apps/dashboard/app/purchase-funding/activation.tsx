'use client';

import { FormEvent, useRef, useState } from 'react';
import { CatalogError, CatalogWrite, money, newWrite, write } from '../../lib/catalog';
import { ActivationResult, MembershipState, PurchaseFunding } from '../../lib/purchase-funding';

const labels: Record<MembershipState['status'], string> = {
  NOT_CREATED: 'Pending activation · Membership will be created on approval',
  PENDING_ACTIVATION: 'Pending activation',
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  INELIGIBLE: 'Ineligible for activation',
};

const errors: Record<string, string> = {
  ACTIVATION_OVERRIDE_REQUIRED: 'The purchase has a balance due. Review its current funding and approve an override to proceed.',
  ACTIVATION_OVERRIDE_REASON_REQUIRED: 'Enter a reason for activating with a balance due.',
  MEMBERSHIP_ALREADY_ACTIVATED: 'This membership has already been activated. Refresh the purchase to see its current state.',
  MEMBERSHIP_NOT_ELIGIBLE: 'This purchase is no longer eligible for activation.',
  PURCHASE_OVERFUNDED: 'Allocations exceed the frozen purchase price. Activation could not proceed.',
  PURCHASE_VALIDITY_OUT_OF_RANGE: 'The frozen validity period exceeds the supported calendar range.',
  IDEMPOTENCY_KEY_EXPIRED: 'This confirmation expired. Refresh the purchase before trying again.',
  IDEMPOTENCY_KEY_REUSED: 'This confirmation could not be replayed. Refresh the purchase before trying again.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  CSRF_DENIED: 'Your confirmation could not be verified. Refresh the purchase and confirm again.',
};

export function MembershipActivation({ funding, membership, onBusy, onReload }: {
  funding: PurchaseFunding; membership: MembershipState | null; onBusy: (busy: boolean) => void; onReload: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mustReload, setMustReload] = useState(false);
  const [denied, setDenied] = useState(false);
  const [result, setResult] = useState<ActivationResult['membership']>();
  const intent = useRef<CatalogWrite | null>(null);
  const inFlight = useRef(false);
  const complimentary = funding.purchasePrice === '0.00';
  const needsOverride = funding.fundingStatus !== 'FULLY_FUNDED';
  const status = result?.status ?? membership?.status;
  const eligible = status === 'NOT_CREATED' || status === 'PENDING_ACTIVATION';
  const validReason = /[\p{L}\p{N}]/u.test(reason);

  function reset() {
    setConfirming(false);
    setOverride(false);
    setReason('');
    setError('');
  }

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !eligible || mustReload || !confirming || (needsOverride && (!override || !validReason))) return;
    const payload = needsOverride ? { override: true, overrideReason: reason.trim() } : {};
    if (!intent.current || intent.current.body !== JSON.stringify(payload)) {
      intent.current = newWrite(`purchases/${funding.purchaseId}/activate-membership`, payload);
    }
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const { membership: activated } = await write<ActivationResult>(intent.current);
      if (!activated) throw new CatalogError(503, 'DASHBOARD_UNAVAILABLE');
      setResult(activated);
      reset();
    } catch (failure) {
      if (failure instanceof CatalogError && failure.status === 401) {
        window.location.replace('/?session=expired');
        return;
      }
      if (failure instanceof CatalogError && failure.status === 403 && failure.code === 'FORBIDDEN') {
        setDenied(true);
        return;
      }
      if (failure instanceof CatalogError && failure.status === 409) setMustReload(true);
      setError(failure instanceof CatalogError && errors[failure.code]
        ? errors[failure.code] : 'Activation could not be confirmed. Try again to check the result.');
    } finally {
      setBusy(false);
      onBusy(false);
      inFlight.current = false;
    }
  }

  return <section className="panel funding-summary membership-activation" aria-labelledby="membership-heading">
    <h2 id="membership-heading">Membership activation</h2>
    {denied ? <p className="notice error" role="alert">Your account does not have access to Membership activation.</p> : <>
      <p>{status ? labels[status] : 'Membership status could not be loaded.'}</p>
      {result && <p className="notice success" role="status">
        Membership activated. Valid from {result.validFrom} through {result.validThrough} in Riyadh.
      </p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {(!status || mustReload) && <div><button type="button" className="button secondary" onClick={onReload}>Refresh purchase</button></div>}
      {eligible && !mustReload && !confirming &&
        <div><button type="button" className="button primary" onClick={() => setConfirming(true)}>Activate membership</button></div>}
      {eligible && !mustReload && confirming && <form onSubmit={activate} aria-busy={busy} className="activation-confirmation">
        <h3>Confirm membership activation</h3>
        <p>Validity begins today in Riyadh when you activate.</p>
        {complimentary && <p>Complimentary purchase. No payment is required.</p>}
        {needsOverride && <>
          <label className="activation-override">
            <input type="checkbox" checked={override} onChange={event => setOverride(event.target.checked)} disabled={busy} />
            Override the {money(funding.remainingAmount)} outstanding balance
          </label>
          {override && <label className="activation-reason">Override reason
            <textarea value={reason} onChange={event => setReason(event.target.value)} required maxLength={500} rows={3} disabled={busy} />
          </label>}
        </>}
        <div className="button-row">
          <button type="submit" className="button primary" disabled={busy || (needsOverride && (!override || !validReason))}>
            {busy ? 'Activating…' : 'Confirm activation'}
          </button>
          <button type="button" className="button quiet" disabled={busy} onClick={reset}>Cancel</button>
        </div>
      </form>}
    </>}
  </section>;
}
