'use client';

import { FormEvent, useEffect, useState } from 'react';
import { CatalogError, get, money } from '../../lib/catalog';
import { MembershipState, PurchaseFunding, purchaseUuid } from '../../lib/purchase-funding';
import { Icon } from '../catalog/ui';
import { MembershipActivation } from './activation';

const fundingLabels = {
  UNFUNDED: ['Unfunded', ''],
  PARTIALLY_FUNDED: ['Partially funded', 'draft'],
  FULLY_FUNDED: ['Fully funded', 'published'],
};

const messages: Record<number, string> = {
  400: 'Enter a valid Purchase UUID.',
  403: 'Your account does not have access to Purchase funding.',
  404: 'This Purchase could not be found.',
  409: 'Allocations exceed the frozen Purchase price. Funding information cannot be displayed.',
  429: 'Too many requests. Wait a moment and try again.',
  500: 'Purchase funding could not be loaded.',
  503: 'Purchase funding is temporarily unavailable.',
};

type Lookup =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'loaded'; funding: PurchaseFunding; membership: MembershipState | null }
  | { state: 'error'; status: number; retry?: () => void };

export function FundingViewer() {
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const [ready, setReady] = useState(false);
  const [activating, setActivating] = useState(false);
  useEffect(() => setReady(true), []);
  const loading = lookup.state === 'loading';

  async function load(id: string) {
    if (!purchaseUuid.test(id)) {
      setLookup({ state: 'error', status: 400 });
      return;
    }
    setLookup({ state: 'loading' });
    try {
      const funding = await get<PurchaseFunding>(`purchases/${id}/funding`);
      const membership = await get<MembershipState>(`purchases/${id}/membership`).catch(error => {
        if (error instanceof CatalogError && (error.status === 401 || error.status === 403)) throw error;
        return null;
      });
      setLookup({ state: 'loaded', funding, membership });
    } catch (error) {
      const status = error instanceof CatalogError ? error.status : 503;
      if (status === 401) {
        window.location.replace('/?session=expired');
        return;
      }
      setLookup({ state: 'error', status, retry: status >= 500 || status === 429 ? () => void load(id) : undefined });
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || loading || activating) return;
    void load(String(new FormData(event.currentTarget).get('purchaseId') ?? '').trim().toLowerCase());
  }

  const error = lookup.state === 'error' ? lookup : undefined;
  const denied = error?.status === 403;
  const funding = lookup.state === 'loaded' ? lookup.funding : undefined;

  return <>
    {!denied && <form className="panel funding-lookup" onSubmit={submit} aria-busy={loading}>
      <label>Purchase ID
        <input name="purchaseId" type="text" autoComplete="off" spellCheck={false}
          aria-invalid={error?.status === 400 || undefined} aria-describedby={error?.status === 400 ? 'funding-error' : undefined}
          disabled={!ready || loading || activating} />
      </label>
      <button type="submit" className="button primary" disabled={!ready || loading || activating}><Icon name="search" /> View funding</button>
    </form>}
    {loading && <div className="empty" role="status"><span className="spinner" />Loading Purchase funding…</div>}
    {error && <div className="notice error" role="alert" id="funding-error">
      <p>{messages[error.status] ?? 'Purchase funding could not be loaded.'}</p>
      {error.retry && <button type="button" className="button quiet" onClick={error.retry}>
        Try again
      </button>}
      {denied && <a className="button quiet" href="/">Back to dashboard</a>}
    </div>}
    {funding && <section className="panel funding-summary" aria-labelledby="funding-summary-heading" aria-live="polite">
      <h2 id="funding-summary-heading">Funding summary</h2>
      <dl className="terms">
        <div><dt>Purchase ID</dt><dd>{funding.purchaseId}</dd></div>
        <div><dt>Purchase price</dt><dd>{money(funding.purchasePrice)}</dd></div>
        <div><dt>Allocated amount</dt><dd>{money(funding.allocatedAmount)}</dd></div>
        <div><dt>Remaining amount</dt><dd>{money(funding.remainingAmount)}</dd></div>
        <div><dt>Funding status</dt><dd><span className={'badge ' + fundingLabels[funding.fundingStatus][1]}>
          {fundingLabels[funding.fundingStatus][0]}</span></dd></div>
      </dl>
    </section>}
    {lookup.state === 'loaded' && <MembershipActivation key={lookup.funding.purchaseId}
      funding={lookup.funding} membership={lookup.membership} onBusy={setActivating}
      onReload={() => void load(lookup.funding.purchaseId)} />}
  </>;
}
