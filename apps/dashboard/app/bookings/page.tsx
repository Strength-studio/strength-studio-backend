import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { accessCookie, api, refreshCookie } from '../../lib/session';
import { bookingId } from '../../lib/bookings';
import { ClientHistoryBoundary } from '../clients/history-boundary';
import { Icon } from '../catalog/ui';
import { BookingWorkspace } from './workspace';

export const metadata = { title: 'Booking management | Strength Studio', referrer: 'no-referrer' };

function entry(error: string) {
  return <main className="entry"><section className="panel entry-card">
    <h1>Booking management</h1><p className="notice error" role="alert">{error}</p>
    <a className="button quiet" href="/">Back to dashboard</a>
  </section></main>;
}

export default async function BookingPage({ searchParams }: {
  searchParams: Promise<{ scheduledSessionId?: string | string[] }>;
}) {
  const session = await cookies();
  const token = session.get(accessCookie)?.value;
  if (!token && session.has(refreshCookie)) redirect('/?session=expired');
  if (!token) return entry('Sign in to continue.');
  const response = await api('me', 'GET', { token }).catch(() => null);
  if (response?.status === 401) redirect('/?session=expired');
  const account = response?.ok ? await response.json().catch(() => null) : null;
  if (!account) return entry('Booking management is temporarily unavailable.');
  if (account.role !== 'ADMIN') return entry('Your account does not have access to Booking management.');
  const { scheduledSessionId } = await searchParams;
  const initialSession = typeof scheduledSessionId === 'string' && bookingId.test(scheduledSessionId)
    ? scheduledSessionId.toLowerCase() : '';

  return <ClientHistoryBoundary>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="layers" size={23} /></span>
        <div><strong>Strength Studio</strong><span>Studio operations</span></div></div>
      <nav aria-label="Studio navigation">
        <p className="eyebrow">Workspace</p>
        <a href="/"><Icon name="boxes" /> Catalog</a>
        <a href="/clients"><Icon name="users" /> Clients</a>
        <a href="/scheduling"><Icon name="file" /> Scheduling</a>
        <a href="/bookings" className="active" aria-current="page"><Icon name="users" /> Booking management</a>
      </nav>
      <div className="sidebar-foot"><span className="status-dot" /> Studio dashboard</div>
    </aside>
    <main className="workspace-main">
      <div className="topbar"><span className="breadcrumb">Studio <span>/</span> Booking management</span></div>
      <div className="workspace-content">
        <header className="section-heading"><h1>Booking management</h1></header>
        <BookingWorkspace initialSession={initialSession} />
      </div>
    </main>
  </ClientHistoryBoundary>;
}
