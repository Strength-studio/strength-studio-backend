import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { bookingId } from '../../lib/bookings';
import { accessCookie, api, refreshCookie } from '../../lib/session';
import { ClientHistoryBoundary } from '../clients/history-boundary';
import { AttendanceWorkspace, CoachSessions } from './workspace';

export const metadata = { title: 'Attendance | Strength Studio', referrer: 'no-referrer' };

function entry(message: string) {
  return <main className="entry"><section className="panel entry-card">
    <h1>Attendance</h1><p className="notice error" role="alert">{message}</p>
    <a className="button quiet" href="/">Back to dashboard</a>
  </section></main>;
}

export default async function AttendancePage({ searchParams }: {
  searchParams: Promise<{ scheduledSessionId?: string | string[] }>;
}) {
  const session = await cookies();
  const token = session.get(accessCookie)?.value;
  if (!token && session.has(refreshCookie)) redirect('/?session=expired');
  if (!token) return entry('Sign in to continue.');
  const response = await api('me', 'GET', { token }).catch(() => null);
  if (response?.status === 401) redirect('/?session=expired');
  const account = response?.ok ? await response.json().catch(() => null) : null;
  if (!account) return entry('Attendance is temporarily unavailable.');
  if (account.role !== 'ADMIN' && account.role !== 'COACH') return entry('Your account does not have access to Attendance.');

  const { scheduledSessionId } = await searchParams;
  if (scheduledSessionId !== undefined && (typeof scheduledSessionId !== 'string' || !bookingId.test(scheduledSessionId))) {
    return entry('This scheduled session could not be found.');
  }
  const coach = account.role === 'COACH';
  return <ClientHistoryBoundary>
    <aside className="sidebar">
      <div className="brand"><strong>Strength Studio</strong></div>
      <nav aria-label="Studio navigation">
        <a href="/">Dashboard</a>
        {coach ? <a href="/attendance">My sessions</a> : <a href="/scheduling">Scheduling</a>}
      </nav>
    </aside>
    <main className="workspace-main">
      <div className="workspace-content">
        <header className="section-heading"><h1>{coach ? 'Attendance' : 'Attendance review'}</h1></header>
        {scheduledSessionId
          ? <AttendanceWorkspace key={scheduledSessionId} sessionId={scheduledSessionId} coach={coach} />
          : coach ? <CoachSessions /> : <p>Select a session in <a href="/scheduling">Scheduling</a> to review attendance.</p>}
      </div>
    </main>
  </ClientHistoryBoundary>;
}
