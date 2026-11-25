import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { accessCookie, api, refreshCookie } from '../../lib/session';
import { ClientHistoryBoundary } from '../clients/history-boundary';
import { CommercialWorkspace } from './workspace';

export const metadata = { title: 'Purchase operations | Strength Studio', referrer: 'no-referrer' };

export default async function CommercialPage() {
  const session = await cookies();
  const token = session.get(accessCookie)?.value;
  if (!token && session.has(refreshCookie)) redirect('/?session=expired');
  const response = token ? await api('me', 'GET', { token }).catch(() => null) : null;
  if (response?.status === 401) redirect('/?session=expired');
  const account = response?.ok ? await response.json().catch(() => null) : null;
  const error = !token ? 'Sign in to continue.' : !account ? 'Purchase operations are temporarily unavailable.'
    : account.role !== 'ADMIN' ? 'Your account does not have access to Purchase operations.' : null;
  if (error) return <main className="entry"><section className="panel entry-card"><h1>Purchase operations</h1>
    <p role="alert" className="notice error">{error}</p><a href="/">Back to dashboard</a></section></main>;
  return <ClientHistoryBoundary>
    <aside className="sidebar"><div className="brand"><strong>Strength Studio</strong></div><nav aria-label="Studio navigation">
      <a href="/">Catalog</a><a href="/clients">Clients</a><a href="/commercial" className="active" aria-current="page">Purchase operations</a>
      <a href="/purchase-funding">Purchase funding</a>
    </nav></aside><main className="workspace-main"><div className="workspace-content">
      <header className="section-heading"><div><h1>Purchase operations</h1><p>Existing-Client positive-price purchase, payment and explicit activation.</p></div></header>
      <CommercialWorkspace />
    </div></main>
  </ClientHistoryBoundary>;
}
