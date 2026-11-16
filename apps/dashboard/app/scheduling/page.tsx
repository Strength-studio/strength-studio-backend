import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { accessCookie, api, refreshCookie } from '../../lib/session';
import { ClientHistoryBoundary } from '../clients/history-boundary';
import { Icon } from '../catalog/ui';
import { ScheduleWorkspace } from './workspace';

export const metadata = { title: 'Scheduling | Strength Studio', referrer: 'no-referrer' };

async function schedulingAccess() {
  const session = await cookies();
  const token = session.get(accessCookie)?.value;
  if (!token && session.has(refreshCookie)) redirect('/?session=expired');
  if (!token) return 'Sign in to continue.';
  const response = await api('me', 'GET', { token }).catch(() => null);
  if (response?.status === 401) redirect('/?session=expired');
  const account = response?.ok ? await response.json().catch(() => null) : null;
  if (!account) return 'Scheduling is temporarily unavailable.';
  if (account.role !== 'ADMIN') return 'Your account does not have access to Scheduling.';
}

export default async function SchedulingPage() {
  const error = await schedulingAccess();
  if (error) return <main className="entry"><section className="panel entry-card">
    <h1>Scheduling</h1><p className="notice error" role="alert">{error}</p>
    <a className="button quiet" href="/">Back to dashboard</a>
  </section></main>;

  return <ClientHistoryBoundary>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="layers" size={23} /></span>
        <div><strong>Strength Studio</strong><span>Studio operations</span></div></div>
      <nav aria-label="Studio navigation">
        <p className="eyebrow">Workspace</p>
        <a href="/"><Icon name="boxes" /> Catalog</a>
        <a href="/purchase-funding"><Icon name="file" /> Purchase funding</a>
        <a href="/scheduling" className="active" aria-current="page"><Icon name="file" /> Scheduling</a>
        <a href="/bookings"><Icon name="users" /> Booking management</a>
      </nav>
      <div className="sidebar-foot"><span className="status-dot" /> Studio dashboard</div>
    </aside>
    <main className="workspace-main">
      <div className="topbar"><span className="breadcrumb">Studio <span>/</span> Scheduling</span></div>
      <div className="workspace-content">
        <header className="section-heading"><h1>Scheduling</h1></header>
        <ScheduleWorkspace />
      </div>
    </main>
  </ClientHistoryBoundary>;
}
