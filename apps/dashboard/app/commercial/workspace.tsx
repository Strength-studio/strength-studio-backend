'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { CatalogError, CatalogWrite, dateTime, get, money, newWrite, Version, write } from '../../lib/catalog';
import { MembershipState, PurchaseFunding } from '../../lib/purchase-funding';
import { MembershipActivation } from '../purchase-funding/activation';

type Client = { id: string; displayName: string; email: string; accountState: string };
type Page<T> = { items: T[]; nextCursor: string | null };
type AuditEvent = { id: string; createdAt: string; actorId: string | null; action: string; targetType: string; targetId: string; requestId: string | null; reason: string | null };
const cents = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); };
type Receipt = { intent?: CatalogWrite; id?: string; verify?: CatalogWrite; verified?: boolean; allocate?: CatalogWrite; allocated?: boolean };

export function CommercialWorkspace() {
  const [accessFailure, setAccessFailure] = useState<401 | 403 | null>(null);
  if (accessFailure) return <p className="notice error" role="alert">{accessFailure === 401
    ? 'Your session expired. Sign in again to continue.' : 'Your account does not have access to Purchase operations.'}</p>;
  return <CommercialWorkflow onAccessFailure={setAccessFailure} />;
}

function CommercialWorkflow({ onAccessFailure }: { onAccessFailure: (status: 401 | 403) => void }) {
  const [clients, setClients] = useState<Client[]>([]), [versions, setVersions] = useState<Version[]>([]);
  const [clientCursor, setClientCursor] = useState<string | null>(null), [packageCursor, setPackageCursor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState(''), [versionId, setVersionId] = useState('');
  const [agreementMethod, setAgreementMethod] = useState('SIGNED_AGREEMENT');
  const [agreementEvidence, setAgreementEvidence] = useState(''), [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState(''), [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState(''), [evidence, setEvidence] = useState('');
  const [purchaseId, setPurchaseId] = useState(''), [paymentId, setPaymentId] = useState('');
  const [funding, setFunding] = useState<PurchaseFunding | null>(null), [membership, setMembership] = useState<MembershipState | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]), [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [activationRevision, setActivationRevision] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [acceptanceStarted, setAcceptanceStarted] = useState(false), [paymentStarted, setPaymentStarted] = useState(false);
  const acceptance = useRef<CatalogWrite | null>(null), receipt = useRef<Receipt>({}), inFlight = useRef(false);
  const active = useRef(true);
  const transport = useRef(new AbortController());
  const client = clients.find(item => item.id === clientId), version = versions.find(item => item.id === versionId);

  function failed(cause: unknown) {
    if (!active.current) return;
    if (cause instanceof CatalogError && (cause.status === 401 || (cause.status === 403 && cause.code === 'FORBIDDEN'))) {
      active.current = false;
      transport.current.abort();
      acceptance.current = null; receipt.current = {};
      // Unmount the workflow to discard all Client, agreement, receipt, funding and audit state.
      onAccessFailure(cause.status as 401 | 403);
      if (cause.status === 401) window.location.replace('/?session=expired');
      return;
    }
    setError(cause instanceof CatalogError ? `Request could not complete (${cause.code}). Review the current record and retry the same operation.`
      : 'The result could not be confirmed. Retry this operation with its original request.');
  }
  async function current<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!active.current) throw new Error('WORKSPACE_INVALIDATED');
    const controller = transport.current;
    try {
      const result = await run(controller.signal);
      if (!active.current || controller !== transport.current) throw new Error('WORKSPACE_INVALIDATED');
      return result;
    } catch (cause) { if (controller === transport.current) failed(cause); throw cause; }
  }
  async function chooseClients(after: string | null = null) {
    const query = new URLSearchParams({ limit: '20', accountState: 'ACTIVE', ...(search.trim() ? { q: search.trim() } : {}), ...(after ? { after } : {}) });
    const page = await current(signal => get<Page<Client>>(`clients?${query}`, signal));
    setClients(previous => after ? [...previous, ...page.items] : page.items); setClientCursor(page.nextCursor);
  }
  async function choosePackages(after: string | null = null) {
    const page = await current(signal => get<Page<Version>>('packages?' + new URLSearchParams({ limit: '20', ...(after ? { after } : {}) }), signal));
    const eligible = page.items.filter(item => item.currency === 'SAR' && !/^0(?:\.0+)?$/.test(item.price));
    setVersions(previous => after ? [...previous, ...eligible] : eligible); setPackageCursor(page.nextCursor);
  }
  async function readAudit(after: string | null = null) {
    const page = await current(signal => get<Page<AuditEvent>>(`purchases/${purchaseId}/audit?` + new URLSearchParams({ limit: '20', ...(after ? { after } : {}) }), signal));
    setAudit(previous => after ? [...previous, ...page.items] : page.items); setAuditCursor(page.nextCursor);
  }
  async function refresh(resetActivation = false) {
    const [f, m] = await Promise.all([current(signal => get<PurchaseFunding>(`purchases/${purchaseId}/funding`, signal)),
      current(signal => get<MembershipState>(`purchases/${purchaseId}/membership`, signal))]);
    if (!active.current) throw new Error('WORKSPACE_INVALIDATED');
    setFunding(f); setMembership(m);
    if (resetActivation) setActivationRevision(value => value + 1);
  }
  async function reading(run: () => Promise<void>) {
    if (!active.current || inFlight.current) return;
    const controller = transport.current;
    inFlight.current = true; setBusy(true); setError('');
    try { await run(); } catch (cause) { if (controller === transport.current) failed(cause); } finally {
      if (controller === transport.current) { inFlight.current = false; if (active.current) setBusy(false); }
    }
  }
  useEffect(() => {
    active.current = true;
    if (transport.current.signal.aborted) transport.current = new AbortController();
    void reading(async () => { await chooseClients(); await choosePackages(); });
    return () => { active.current = false; transport.current.abort(); inFlight.current = false; acceptance.current = null; receipt.current = {}; };
  }, []);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !client || !version) return;
    await reading(async () => {
      acceptance.current ??= newWrite('purchases/positive-price', { clientId, packageId: version.packageId, packageVersionId: version.id,
        agreementMethod, agreementEvidence: agreementEvidence.trim(), purpose: purpose.trim() });
      setAcceptanceStarted(true);
      let result: { purchaseId?: string };
      const intent = acceptance.current;
      try { result = await current(signal => write<{ purchaseId: string }>(intent, signal)); } catch (cause) {
        if (cause instanceof CatalogError && (cause.status === 400 || ['CLIENT_NOT_ACTIVE', 'CATALOG_VERSION_NOT_ELIGIBLE'].includes(cause.code))) {
          acceptance.current = null; setAcceptanceStarted(false);
        }
        throw cause;
      }
      if (!result.purchaseId) throw new Error('Missing purchase identifier');
      setPurchaseId(result.purchaseId); setAmount(version.price); setNotice('Purchase accepted. Membership has not been activated.');
    });
  }
  async function fund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !purchaseId || !client) return;
    if (!/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,2})?$/.test(amount) || /^0(?:\.0+)?$/.test(amount)) { setError('Enter a positive SAR amount with at most two decimal places.'); return; }
    if (!paymentStarted && version && cents(amount) > cents(version.price)) { setError('The payment for this workflow cannot exceed the frozen purchase price. Review the amount.'); return; }
    await reading(async () => {
      const checkpoint = receipt.current;
      checkpoint.intent ??= newWrite('payments', { clientId, intakeId: crypto.randomUUID(), amount, currency: 'SAR', method,
        receivedAt: new Date().toISOString(), ...(reference.trim() ? { reference: reference.trim() } : {}), ...(evidence.trim() ? { evidence: evidence.trim() } : {}) });
      setPaymentStarted(true);
      if (!checkpoint.id) {
        let result: { paymentId?: string };
        const intent = checkpoint.intent;
        try { result = await current(signal => write<{ paymentId: string }>(intent, signal)); } catch (cause) {
          if (cause instanceof CatalogError && cause.status === 400) { checkpoint.intent = undefined; setPaymentStarted(false); }
          throw cause;
        }
        if (!result.paymentId) throw new Error('Missing receipt identifier');
        checkpoint.id = result.paymentId; setPaymentId(result.paymentId);
      }
      if (!checkpoint.verified) {
        checkpoint.verify ??= newWrite(`payments/${checkpoint.id}/verify`, {});
        const intent = checkpoint.verify;
        await current(signal => write(intent, signal)); checkpoint.verified = true;
      }
      if (!checkpoint.allocated) {
        checkpoint.allocate ??= newWrite(`payments/${checkpoint.id}/allocations`, { purchaseId, amount: JSON.parse(checkpoint.intent.body).amount });
        const intent = checkpoint.allocate;
        await current(signal => write(intent, signal)); checkpoint.allocated = true;
      }
      await refresh();
      setNotice('Payment recorded, verified and allocated. Membership activation is a separate Admin action.');
    });
  }

  return <section className="panel commercial-workspace" aria-busy={busy}>
    <header className="panel-heading"><h2>Positive-price purchase</h2><span className="badge published">Admin workflow</span></header>
    {error && <p className="notice error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {!purchaseId ? <>
      <form className="filters" onSubmit={event => { event.preventDefault(); setClientId(''); void reading(() => chooseClients()); }}>
        <label>Find active Client<input name="clientSearch" value={search} maxLength={120} onChange={event => { setSearch(event.target.value); setClientCursor(null); }} disabled={busy || acceptanceStarted} /></label>
        <button className="button secondary" disabled={busy || acceptanceStarted}>Search Clients</button>
      </form>
      {!acceptanceStarted && <button type="button" disabled={busy} onClick={() => void reading(async () => { await chooseClients(); await choosePackages(); })}>Reload choices</button>}
      <form className="commercial-form" onSubmit={accept}>
        <label>Existing active Client<select name="clientId" required value={clientId} onChange={event => setClientId(event.target.value)} disabled={busy || acceptanceStarted}>
          <option value="">Select Client</option>{clients.map(item => <option key={item.id} value={item.id}>{item.displayName} — {item.email}</option>)}</select></label>
        {clientCursor && <button type="button" disabled={busy || acceptanceStarted} onClick={() => void reading(() => chooseClients(clientCursor))}>Load more Clients</button>}
        <label>Published positive-price package<select name="packageVersionId" required value={versionId} onChange={event => setVersionId(event.target.value)} disabled={busy || acceptanceStarted}>
          <option value="">Select package</option>{versions.map(item => <option key={item.id} value={item.id}>{item.name} · v{item.version} · {money(item.price)}</option>)}</select></label>
        {packageCursor && <button type="button" disabled={busy || acceptanceStarted} onClick={() => void reading(() => choosePackages(packageCursor))}>Load more packages</button>}
        {!versions.length && <p>No eligible packages on this page. Load more if available.</p>}
        {version && <p>Price: {money(version.price)} · Validity: {version.validityDays} days. Terms freeze on acceptance.</p>}
        <label>Agreement method<select name="agreementMethod" value={agreementMethod} onChange={event => setAgreementMethod(event.target.value)} disabled={busy || acceptanceStarted}>
          <option value="SIGNED_AGREEMENT">Signed agreement</option><option value="VERBAL_AGREEMENT">Verbal agreement</option></select></label>
        <label>Agreement evidence<textarea name="agreementEvidence" required maxLength={2000} value={agreementEvidence} onChange={event => setAgreementEvidence(event.target.value)} disabled={busy || acceptanceStarted} /></label>
        <label>Purpose<input name="purpose" required maxLength={240} value={purpose} onChange={event => setPurpose(event.target.value)} disabled={busy || acceptanceStarted} /></label>
        <button className="button primary" disabled={busy || !clientId || !versionId || !agreementEvidence.trim() || !purpose.trim()}>{acceptanceStarted ? 'Retry same acceptance' : 'Record purchase acceptance'}</button>
      </form>
    </> : <>
      <p>Purchase ID: <code data-purchase-id="">{purchaseId}</code> · Client: {client?.displayName}</p>
      {paymentId && <p>Payment ID: <code data-payment-id="">{paymentId}</code> · {receipt.current.allocated ? 'Allocated' : receipt.current.verified ? 'Verified; allocation pending' : 'Recorded; verification pending'}</p>}
      {paymentId && <a href="/purchase-funding" target="_blank" rel="noopener noreferrer">Review the purchase in Purchase funding using its ID</a>}
      <p className="muted">Keep this workflow open until finished. Copy the identifiers before leaving; this browser does not store agreement or receipt details after navigation.</p>
      {!funding && <form className="commercial-form" onSubmit={fund}>
        <label>Payment amount (SAR)<input name="amount" required inputMode="decimal" pattern="(0|[1-9][0-9]{0,14})(\.[0-9]{1,2})?" value={amount} onChange={event => setAmount(event.target.value)} disabled={busy || paymentStarted} /></label>
        <label>Payment method<select name="paymentMethod" value={method} onChange={event => setMethod(event.target.value)} disabled={busy || paymentStarted}>
          <option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="MADA">Mada</option><option value="STC_PAY">STC Pay</option></select></label>
        <label>Payment reference (optional)<input name="reference" maxLength={200} value={reference} onChange={event => setReference(event.target.value)} disabled={busy || paymentStarted} /></label>
        <label>Payment evidence (optional)<textarea name="evidence" maxLength={2000} value={evidence} onChange={event => setEvidence(event.target.value)} disabled={busy || paymentStarted} /></label>
        <button className="button primary" disabled={busy || !/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,2})?$/.test(amount) || /^0(?:\.0+)?$/.test(amount)}>
          {paymentStarted ? 'Retry remaining payment steps' : 'Record, verify and allocate payment'}</button>
      </form>}
      {funding && <><dl className="terms"><div><dt>Purchase price</dt><dd>{money(funding.purchasePrice)}</dd></div><div><dt>Allocated</dt><dd>{money(funding.allocatedAmount)}</dd></div>
        <div><dt>Remaining</dt><dd>{money(funding.remainingAmount)}</dd></div><div><dt>Funding status</dt><dd>{funding.fundingStatus}</dd></div></dl>
        <MembershipActivation key={activationRevision} funding={funding} membership={membership} signal={transport.current.signal}
          onBusy={value => { if (active.current) setBusy(value); }} onAccessFailure={failed}
          onReload={() => void reading(() => refresh(true))} /></>}
      <section className="commercial-audit" aria-labelledby="purchase-audit-heading"><h3 id="purchase-audit-heading">Purchase audit history</h3>
        <button type="button" className="button quiet" disabled={busy} onClick={() => void reading(() => readAudit())}>Refresh history</button>
        {!!audit.length && <ol>{audit.map(item => <li key={item.id}><strong>{item.action.replaceAll('_', ' ')}</strong>
          <span>{item.targetType} · {dateTime(item.createdAt)}</span><small>Actor: {item.actorId ?? 'System'}{item.reason ? ` · ${item.reason}` : ''}</small></li>)}</ol>}
        {auditCursor && <button type="button" disabled={busy} onClick={() => void reading(() => readAudit(auditCursor))}>Load more history</button>}
      </section>
    </>}
  </section>;
}
