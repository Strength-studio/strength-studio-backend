import { cookies } from 'next/headers';
import { accessCookie, api } from '../../lib/session';
import { Icon } from '../catalog/ui';
import { ClientHistoryBoundary } from '../clients/history-boundary';
import { FundingViewer } from './viewer';

export const metadata = { title: 'Purchase funding | Strength Studio', referrer: 'no-referrer' };

async function fundingAccess() {
  const token = (await cookies()).get(accessCookie)?.value;
  if (!token) return 'Sign in to continue.';
  try {
    const response = await api('me', 'GET', { token });
    if (response.status === 401) return 'Your session expired. Sign in or restore your session.';
    if (response.ok) {
      return (await response.json()).role === 'ADMIN' ? undefined : 'Your account does not have access to Purchase funding.';
    }
  } catch {
    // Use the same unavailable state for failed connections and unexpected responses.
  }
  return 'Purchase funding is temporarily unavailable.';
}

export default async function PurchaseFundingPage() {
  const error = await fundingAccess();
  if (error) return <main className="entry"><section className="panel entry-card">
    <h1>Purchase funding</h1>
    <p className="notice error" role="alert">{error}</p>
    <div className="button-row">
      <a className="button quiet" href="/">Back to dashboard</a>
      {error === 'Purchase funding is temporarily unavailable.' &&
        <a className="button secondary" href="/purchase-funding">Try again</a>}
    </div>
  </section></main>;

  return <ClientHistoryBoundary>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="layers" size={23} /></span>
        <div><strong>Strength Studio</strong><span>Studio operations</span></div>
      </div>
      <nav aria-label="Studio navigation">
        <p className="eyebrow">Workspace</p>
        <a href="/"><Icon name="boxes" /> Catalog</a>
        <a href="/purchase-funding" className="active" aria-current="page"><Icon name="file" /> Purchase funding</a>
      </nav>
      <div className="sidebar-foot"><span className="status-dot" /> Studio dashboard</div>
    </aside>
    <main className="workspace-main">
      <div className="topbar"><span className="breadcrumb">Studio <span>/</span> Purchase funding</span></div>
      <div className="workspace-content funding-workspace">
        <header className="section-heading"><div><h1>Purchase funding</h1>
          <p className="muted">Enter a Purchase ID to view its price, allocations, and remaining amount.</p></div>
        </header>
        <FundingViewer />
      </div>
    </main>
  </ClientHistoryBoundary>;
}
