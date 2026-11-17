'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CatalogError, dateTime, get, newWrite, write } from '../../lib/catalog';
import type { CatalogWrite, Page } from '../../lib/catalog';
import type { Booking, BookingMembership, BookingPage, BookingStatus } from '../../lib/bookings';
import type { ScheduledSession } from '../../lib/scheduling';

const riyadhDate = (instant: number) => new Date(instant + 3 * 60 * 60_000).toISOString().slice(0, 10);
const labels: Record<BookingStatus, string> = {
  PENDING: 'Pending', CONFIRMED: 'Confirmed', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};
const reasons: Record<string, string> = {
  SESSION_CANCELLED: 'The scheduled session was cancelled.',
  MEMBERSHIP_INACTIVE: 'Membership is inactive.',
  MEMBERSHIP_EXPIRED: 'Membership has expired.',
  OUTSIDE_VALIDITY: 'The session falls outside the membership validity dates.',
  SESSION_TYPE_NOT_ALLOWED: 'This package does not cover the scheduled session type.',
  ALLOWANCE_EXHAUSTED: 'All membership commitments are in use.',
};
const failures: Record<string, string> = {
  ...reasons,
  SLOT_FULL: 'The session is full. Capacity may have changed since you opened this page.',
  MEMBERSHIP_NOT_ELIGIBLE: 'The selected membership is no longer eligible for this session. Review its coverage and available commitments.',
  BOOKING_ALREADY_EXISTS: 'This Client already has a pending or confirmed booking for the session.',
  BOOKING_STATE_CONFLICT: 'This booking changed. Review its current status before trying again.',
  SCHEDULE_START_IN_PAST: 'The scheduled session has already started. Select a future session to make a booking.',
  SCHEDULED_SESSION_NOT_FOUND: 'The scheduled session could not be found.',
  CLIENT_NOT_FOUND: 'The Client profile could not be found.',
  BOOKING_NOT_FOUND: 'The booking could not be found.',
};

function report(failure: unknown, setError: (message: string) => void) {
  if (failure instanceof CatalogError) {
    if (failure.status === 401) {
      window.location.replace('/?session=expired');
      return;
    }
    setError(failures[failure.code] ?? (failure.status === 403 ? 'Your account does not have access to this action.'
      : failure.status === 400 ? 'Check the form values and try again.' : 'The booking request failed. Try again.'));
    return;
  }
  setError('Booking management is temporarily unavailable.');
}

function sessionSearch(from: string, until: string, after?: string) {
  return 'scheduling/sessions?' + new URLSearchParams({
    from: from + 'T00:00+03:00', until: until + 'T00:00+03:00', ...(after ? { after } : {}),
  });
}

type Client = { id: string; displayName: string; email: string };
type Decision = { booking: Booking; action: 'reject' | 'cancel' };

function SessionBookings({ sessionId }: { sessionId: string }) {
  const [page, setPage] = useState<BookingPage>();
  const [clients, setClients] = useState<Page<Client>>();
  const [clientSearch, setClientSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [choices, setChoices] = useState<BookingMembership[]>();
  const [membershipId, setMembershipId] = useState('');
  const [decision, setDecision] = useState<Decision>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<CatalogWrite | null>(null);
  const working = useRef(false);
  const query = 'scheduledSessionId=' + sessionId;

  const loadBookings = useCallback(async (after?: string) => {
    const result = await get<BookingPage>('bookings?' + query + (after ? '&after=' + after : ''));
    setPage(current => ({ ...result, items: after ? [...(current?.items ?? []), ...result.items] : result.items }));
  }, [query]);

  const loadChoices = useCallback(async (client: string) => {
    const result = await get<BookingMembership[]>('clients/' + client + '/booking-memberships?' + query);
    setChoices(result);
    setMembershipId(current => result.some(item => item.membershipId === current && item.eligible) ? current : '');
  }, [query]);

  useEffect(() => { void loadBookings().catch(failure => report(failure, setError)); }, [loadBookings]);

  async function run(task: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try { await task(); }
    catch (failure) { report(failure, setError); }
    finally { working.current = false; setBusy(false); }
  }

  async function searchClients(q: string, after?: string) {
    const result = await get<Page<Client>>('clients?' + new URLSearchParams({
      ...(q ? { q } : {}), ...(after ? { after } : {}),
    }));
    setClients(current => ({ ...result, items: after ? [...(current?.items ?? []), ...result.items] : result.items }));
  }

  function findClients(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = String(new FormData(event.currentTarget).get('clientSearch')).trim();
    setClientSearch(search);
    setClients(undefined);
    setClientId('');
    setChoices(undefined);
    setMembershipId('');
    void run(() => searchClients(search));
  }

  function pickClient(id: string) {
    setClientId(id);
    setChoices(undefined);
    setMembershipId('');
    if (id) void run(() => loadChoices(id));
  }

  async function refresh() {
    await loadBookings();
    if (clientId) await loadChoices(clientId);
  }

  function save(path: string, payload: object, feedback: string) {
    setNotice('');
    void run(async () => {
      if (pending.current?.path !== path || pending.current.body !== JSON.stringify(payload)) {
        pending.current = newWrite(path, payload);
      }
      try {
        await write(pending.current);
      } catch (failure) {
        if (failure instanceof CatalogError && failure.status === 409) {
          pending.current = null;
          await refresh().catch(refreshFailure => report(refreshFailure, setError));
        }
        throw failure;
      }
      pending.current = null;
      setDecision(undefined);
      setNotice(feedback);
      await refresh();
    });
  }

  const session = page?.session;
  const full = !!session && session.confirmedBookingCount >= session.capacity;
  const cancelled = session?.status === 'CANCELLED';

  return <section className="panel schedule-panel" aria-label="Session bookings">
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {!session && !error && <p role="status">Loading session bookings…</p>}
    {session && <>
      <div className="button-row">
        <h2>{session.sessionTypeName}</h2>
        <button type="button" className="button quiet" onClick={() => void run(refresh)} disabled={busy}>Refresh bookings</button>
      </div>
      <p>{session.coach.displayName} · {dateTime(session.startsAt)} to {dateTime(session.endsAt)} (Riyadh)</p>
      <p>{session.confirmedBookingCount} of {session.capacity} seats occupied</p>
      {cancelled && <p className="notice" role="status">{reasons.SESSION_CANCELLED}</p>}
      {!cancelled && full && <p className="notice" role="status">The session is full.</p>}
      <h3>Booking history</h3>
      {page.items.length ? <div className="schedule-table"><table>
        <thead><tr><th>Client</th><th>Membership</th><th>Status</th><th>Updated (Riyadh)</th><th>Actions</th></tr></thead>
        <tbody>{page.items.map(booking => <tr key={booking.id}>
          <td><a className="text-button" href={'/clients/' + booking.clientId}>{booking.clientDisplayName}</a></td>
          <td>{booking.packageLabel ?? booking.membershipId}</td>
          <td>{labels[booking.status]}{booking.requiresReview && <p className="notice error">
            Admin review required. The membership no longer covers this session.
          </p>}</td>
          <td>{dateTime(booking.updatedAt)}</td>
          <td><div className="button-row">
            {booking.status === 'PENDING' && <>
              <button type="button" className="button quiet" disabled={busy || full || cancelled}
                onClick={() => save('bookings/' + booking.id + '/approve', {}, 'Booking confirmed.')}>Approve</button>
              <button type="button" className="button quiet" disabled={busy}
                onClick={() => setDecision({ booking, action: 'reject' })}>Reject</button>
            </>}
            {(booking.status === 'PENDING' || booking.status === 'CONFIRMED') &&
              <button type="button" className="button quiet" disabled={busy}
                onClick={() => setDecision({ booking, action: 'cancel' })}>Cancel booking</button>}
          </div></td>
        </tr>)}</tbody>
      </table></div> : <p className="muted">No bookings for this session.</p>}
      {page.nextCursor && <button type="button" className="button secondary" disabled={busy}
        onClick={() => void run(() => loadBookings(page.nextCursor!))}>Load more bookings</button>}
      {decision && <form key={decision.booking.id + decision.action} className="schedule-editor" aria-label="Booking decision" onSubmit={event => {
        event.preventDefault();
        const reason = String(new FormData(event.currentTarget).get('reason')).trim();
        if (!reason) return setError('Enter a reason before submitting.');
        const { action, booking } = decision;
        save('bookings/' + booking.id + '/' + action, { reason }, action === 'reject' ? 'Booking rejected.' : 'Booking cancelled.');
      }}>
        <h3>{decision.action === 'reject' ? 'Reject' : 'Cancel booking for'} {decision.booking.clientDisplayName}</h3>
        <label>Reason<textarea name="reason" required maxLength={500} disabled={busy} /></label>
        <div className="button-row">
          <button className="button primary" disabled={busy}>{decision.action === 'reject' ? 'Confirm rejection' : 'Confirm cancellation'}</button>
          <button type="button" className="button quiet" disabled={busy} onClick={() => setDecision(undefined)}>Close</button>
        </div>
      </form>}
      {!cancelled && <>
        <h3>Create booking</h3>
        <form className="button-row" aria-label="Find Client" onSubmit={findClients}>
          <label>Client name or email<input name="clientSearch" maxLength={120} disabled={busy} /></label>
          <button className="button secondary" disabled={busy}>Search clients</button>
        </form>
        {clients && <>
          {clients.items.length ? <label>Client
            <select value={clientId} disabled={busy} onChange={event => pickClient(event.target.value)}>
              <option value="">Select a Client</option>
              {clients.items.map(item => <option key={item.id} value={item.id}>{item.displayName} ({item.email})</option>)}
            </select>
          </label> : <p className="muted">No matching clients.</p>}
          {clients.nextCursor && <button type="button" className="button secondary" disabled={busy}
            onClick={() => void run(() => searchClients(clientSearch, clients.nextCursor!))}>Load more clients</button>}
        </>}
        {choices && (choices.length ? <form aria-label="Create booking" onSubmit={event => {
          event.preventDefault();
          if (membershipId) save('bookings', { scheduledSessionId: sessionId, clientId, membershipId }, 'Booking created as pending.');
        }}>
          <label>Membership<select value={membershipId} required disabled={busy} onChange={event => setMembershipId(event.target.value)}>
            <option value="">Select a membership</option>
            {choices.map(item => <option key={item.membershipId} value={item.membershipId} disabled={!item.eligible}>
              {item.packageLabel ?? 'Membership'} · {item.validFrom ?? '—'} to {item.validThrough ?? '—'} · {item.membershipId.slice(-8)}
            </option>)}
          </select></label>
          <ul>
            {choices.map(item => <li key={item.membershipId}>
              {item.packageLabel ?? 'Membership'} · {item.membershipId.slice(-8)}
              {item.packageKind === 'SESSION' && item.initialSessionAllowance !== null
                && ' · ' + item.remainingCommitments + ' of ' + item.initialSessionAllowance + ' commitments remaining'}
              {item.reason && ' · ' + (reasons[item.reason] ?? 'Ineligible for this session.')}
            </li>)}
          </ul>
          <button className="button primary" disabled={busy || full || !membershipId}>Create pending booking</button>
        </form> : <p className="muted">This Client has no memberships.</p>)}
      </>}
    </>}
  </section>;
}

export function BookingWorkspace({ initialSession }: { initialSession: string }) {
  const [windowDates, setWindowDates] = useState(() => ({
    from: riyadhDate(Date.now()), until: riyadhDate(Date.now() + 7 * 86_400_000),
  }));
  const [sessions, setSessions] = useState<Page<ScheduledSession>>();
  const [selected, setSelected] = useState(initialSession);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const search = useCallback(async (from: string, until: string, after?: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await get<Page<ScheduledSession>>(sessionSearch(from, until, after));
      setSessions(current => ({ ...result, items: after ? [...(current?.items ?? []), ...result.items] : result.items }));
    } catch (failure) { report(failure, setError); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void search(windowDates.from, windowDates.until); }, [search, windowDates]);

  return <>
    <section className="panel schedule-panel" aria-label="Select a scheduled session">
      <form className="button-row" aria-label="Booking date range" onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setWindowDates({ from: String(data.get('from')), until: String(data.get('until')) });
      }}>
        <label>From (Riyadh)<input name="from" type="date" required defaultValue={windowDates.from} disabled={loading} /></label>
        <label>Until (exclusive)<input name="until" type="date" required defaultValue={windowDates.until} disabled={loading} /></label>
        <button className="button secondary" disabled={loading}>Find sessions</button>
      </form>
      {error && <p className="notice error" role="alert">{error}</p>}
      {loading && <p role="status">Loading scheduled sessions…</p>}
      <label>Scheduled session<select value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">Select a scheduled session</option>
        {selected && !sessions?.items.some(item => item.id === selected) && <option value={selected}>Selected session</option>}
        {sessions?.items.map(item => <option key={item.id} value={item.id}>
          {item.sessionTypeName} · {dateTime(item.startsAt)} · {item.coach.displayName}{item.status === 'CANCELLED' ? ' · Cancelled' : ''}
        </option>)}
      </select></label>
      {!loading && sessions?.items.length === 0 && <p className="muted">No sessions in this date range.</p>}
      {sessions?.nextCursor && <button type="button" className="button secondary" disabled={loading}
        onClick={() => void search(windowDates.from, windowDates.until, sessions.nextCursor!)}>Load more sessions</button>}
    </section>
    {selected && <SessionBookings key={selected} sessionId={selected} />}
  </>;
}
