'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttendanceDetail, AttendanceHistory, AttendanceItem } from '../../lib/attendance';
import { CatalogError, CatalogWrite, dateTime, get, newWrite, Page, pagedPath, write } from '../../lib/catalog';
import type { ScheduledSession } from '../../lib/scheduling';

const week = 7 * 86_400_000;
const attendancePath = 'attendance/sessions/';

function requestError(error: unknown) {
  if (error instanceof CatalogError) {
    if (error.status === 401) window.location.replace('/?session=expired');
    if (error.status === 403) return 'Your account does not have access to Attendance.';
    if (error.status === 404) return 'This scheduled session or participant could not be found.';
    if (error.code === 'SESSION_NOT_STARTED') return 'Attendance opens at the scheduled start.';
    if (error.code === 'WORKFLOW_NOT_ENABLED') return 'Attendance submission is currently closed.';
    if (error.status === 409) return 'Attendance or the roster changed. Refresh the roster before submitting again.';
  }
  return 'The attendance request could not be completed. Please try again.';
}

export function CoachSessions() {
  const [windowStart, setWindowStart] = useState<number>();
  const [page, setPage] = useState<Page<ScheduledSession>>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (start: number, after?: string) => {
    setBusy(true);
    setError('');
    const query = new URLSearchParams({
      from: new Date(start).toISOString(), until: new Date(start + 2 * week).toISOString(),
      ...(after ? { after } : {}),
    });
    try {
      const next = await get<Page<ScheduledSession>>('scheduling/my-sessions?' + query);
      setPage(current => ({ items: [...(after ? current?.items ?? [] : []), ...next.items], nextCursor: next.nextCursor }));
      setWindowStart(start);
    } catch (failure) {
      setPage(undefined);
      setError(requestError(failure));
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(Date.now() - week); }, [load]);

  return <section className="panel" aria-label="My scheduled sessions">
    <h2>My scheduled sessions</h2>
    {windowStart !== undefined && <>
      <p>Riyadh time · {dateTime(new Date(windowStart).toISOString())} to {dateTime(new Date(windowStart + 2 * week).toISOString())}</p>
      <div className="button-row">
        <button className="button quiet" disabled={busy} onClick={() => void load(windowStart - 2 * week)}>Earlier sessions</button>
        <button className="button quiet" disabled={busy} onClick={() => void load(windowStart + 2 * week)}>Later sessions</button>
      </div>
    </>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {busy && <p role="status">Loading sessions…</p>}
    {page && (page.items.length
      ? <ul>{page.items.map(item => <li key={item.id}>
        <a href={'/attendance?scheduledSessionId=' + item.id}>{item.sessionTypeName} · {dateTime(item.startsAt)}</a>
        {item.cancelledAt && ' · Cancelled'}
      </li>)}</ul>
      : <p>No assigned sessions in this date range.</p>)}
    {windowStart !== undefined && page?.nextCursor &&
      <button className="button secondary" disabled={busy} onClick={() => void load(windowStart, page.nextCursor!)}>Load more sessions</button>}
  </section>;
}

export function AttendanceWorkspace({ sessionId, coach }: { sessionId: string; coach: boolean }) {
  const path = attendancePath + sessionId;
  const [detail, setDetail] = useState<AttendanceDetail>();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState<CatalogWrite>();
  const [recordId, setRecordId] = useState<string>();
  const savingNow = useRef(false);

  const load = useCallback(async (after?: string) => {
    setLoading(true);
    setError('');
    if (!after) setSelected([]);
    try {
      const next = await get<AttendanceDetail>(pagedPath(path, 50, after));
      setDetail(current => ({ ...next, items: [...(after ? current?.items ?? [] : []), ...next.items] }));
    } catch (failure) {
      setDetail(undefined);
      setSelected([]);
      setError(requestError(failure));
    } finally { setLoading(false); }
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  async function submit(intent: CatalogWrite) {
    if (savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await write(intent);
      setRetry(undefined);
      setNotice('Attendance submitted for review.');
      await load();
    } catch (failure) {
      if (failure instanceof CatalogError && failure.status >= 500) {
        setRetry(intent);
        setError('Submission could not be confirmed. Retry the same request.');
      } else {
        setRetry(undefined);
        setSelected([]);
        setDetail(undefined);
        setError(requestError(failure));
      }
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  const session = detail?.session;
  const started = !!detail && Date.parse(detail.serverTime) >= Date.parse(detail.session.startsAt);
  const selectable = coach && !!detail?.submissionEnabled && started && !session?.cancelledAt;
  const busy = loading || saving;

  return <section className="panel" aria-label="Session attendance">
    <div className="button-row">
      <button className="button secondary" disabled={busy} onClick={() => void load()}>Refresh roster</button>
      {retry && <button className="button primary" disabled={busy} onClick={() => void submit(retry)}>Retry submission</button>}
    </div>
    {error && <p role="alert" className="notice error">{error}</p>}
    {notice && <p role="status" className="notice success">{notice}</p>}
    {loading && <p role="status">Loading attendance…</p>}
    {session && detail && <>
      <h2>{session.served?.sessionTypeName ?? session.sessionTypeName}</h2>
      <p>{session.served?.coachDisplayName ?? session.coach.displayName} · {dateTime(session.served?.startsAt ?? session.startsAt)} (Riyadh)</p>
      {session.cancelledAt && <p className="notice">This session was cancelled.</p>}
      {coach && !session.cancelledAt && (detail.submissionEnabled
        ? !started && <p>Attendance opens at the scheduled start. Refresh the roster when the session starts.</p>
        : <p>Attendance submission is currently closed.</p>)}
      <form onSubmit={event => {
        event.preventDefault();
        if (!selectable || selected.length === 0 || busy || retry) return;
        const entries = detail.items.filter(row => selected.includes(row.bookingId))
          .map(row => ({ bookingId: row.bookingId, expectedRevision: row.revision, outcome: 'ATTENDED' }));
        void submit(newWrite(path + '/submit', { expectedScheduleRevision: session.revision, entries }));
      }}>
        {detail.items.length ? <div className="schedule-table"><table>
          <caption>Participant roster</caption>
          <thead><tr>{selectable && <th scope="col">Attended</th>}<th scope="col">Participant</th><th scope="col">Review status</th><th scope="col">Record</th></tr></thead>
          <tbody>{detail.items.map(row => <tr key={row.bookingId}>
            {selectable && <td>{row.reviewStatus === 'UNSUBMITTED' && row.bookingStatus === 'CONFIRMED' &&
              <input type="checkbox" aria-label={'Mark ' + row.clientDisplayName + ' attended'}
                checked={selected.includes(row.bookingId)}
                disabled={busy || !!retry || (selected.length >= 50 && !selected.includes(row.bookingId))}
                onChange={event => {
                  const checked = event.target.checked;
                  setSelected(current => checked ? [...current, row.bookingId] : current.filter(id => id !== row.bookingId));
                }} />}</td>}
            <td>{row.clientDisplayName}{row.bookingStatus === 'CANCELLED' && ' · Booking cancelled'}</td>
            <td>{row.reviewStatus === 'RETURNED' ? 'Returned' : row.reviewStatus === 'PENDING_REVIEW' ? 'Pending review' : 'Unsubmitted'}
              {row.submittedAt && <><br /><time dateTime={row.submittedAt}>{dateTime(row.submittedAt)}</time></>}</td>
            <td>{row.revision > 0 && <button type="button" className="button quiet" disabled={busy}
              aria-expanded={recordId === row.bookingId} onClick={() => setRecordId(row.bookingId)}>
              Review {row.clientDisplayName}
            </button>}</td>
          </tr>)}</tbody>
        </table></div> : <p>No confirmed participants or submitted attendance.</p>}
        {selectable && detail.items.some(row => row.reviewStatus === 'UNSUBMITTED') &&
          <button className="button primary" disabled={busy || !!retry || selected.length === 0}>Submit attendance</button>}
        {selected.length >= 50 && <p>Submit up to 50 participants at a time.</p>}
      </form>
      {detail.nextCursor && <button className="button secondary" disabled={busy}
        onClick={() => void load(detail.nextCursor!)}>Load more participants</button>}
      {detail.items.filter(row => row.bookingId === recordId).map(row => <ParticipantReview key={row.bookingId}
        sessionPath={path} item={row} coach={coach} scheduleRevision={session.revision}
        enabled={!session.cancelledAt && row.bookingStatus === 'CONFIRMED' && started
          && (coach ? detail.submissionEnabled : detail.returnEnabled)}
        onChanged={async message => { setNotice(message); await load(); }} />)}
    </>}
  </section>;
}

function ParticipantReview({ sessionPath, item, coach, scheduleRevision, enabled, onChanged }: {
  sessionPath: string; item: AttendanceItem; coach: boolean; scheduleRevision: number; enabled: boolean;
  onChanged: (message: string) => Promise<void>;
}) {
  const path = sessionPath + '/participants/' + item.bookingId;
  const [history, setHistory] = useState<AttendanceHistory>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [retry, setRetry] = useState<CatalogWrite>();
  const savingNow = useRef(false);

  const load = useCallback(async (after?: string) => {
    setLoading(true);
    setError('');
    if (!after) setAcknowledged(false);
    try {
      const page = await get<AttendanceHistory>(pagedPath(path, 50, after));
      setHistory(current => ({ ...page, items: [...(after ? current?.items ?? [] : []), ...page.items] }));
    } catch (failure) {
      setHistory(undefined);
      setError(requestError(failure));
    } finally { setLoading(false); }
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  async function save(intent: CatalogWrite) {
    if (savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setError('');
    try {
      await write(intent);
      setRetry(undefined);
      setReason('');
      await load();
      await onChanged(coach ? 'Attendance reaffirmed and submitted for review.' : 'Attendance returned to the Coach.');
    } catch (failure) {
      if (failure instanceof CatalogError && failure.status >= 500) {
        setRetry(intent);
        setError('The result could not be confirmed. Retry the same request.');
      } else {
        setRetry(undefined);
        setHistory(undefined);
        setAcknowledged(false);
        setError(requestError(failure));
      }
    } finally { savingNow.current = false; setSaving(false); }
  }

  const latest = history?.items[0];
  const current = latest?.revision === item.revision;
  const busy = loading || saving;
  const pending = current && !latest.reviewDecision && item.reviewStatus === 'PENDING_REVIEW';
  const returned = current && !!latest.reviewDecision && item.reviewStatus === 'RETURNED';

  return <section aria-label={'Attendance record for ' + item.clientDisplayName} className="panel">
    <h3>Attendance record · {item.clientDisplayName}</h3>
    <button className="button quiet" disabled={busy} onClick={() => void load()}>Refresh history</button>
    {loading && <p role="status">Loading attendance history…</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {retry && <button className="button primary" disabled={busy} onClick={() => void save(retry)}>Retry review request</button>}
    {history && (history.items.length ? <ol aria-label="Attendance history">
      {history.items.map(revision => <li key={revision.id}>
        <p>Revision {revision.revision} · {revision.submissionKind === 'ORIGINAL' ? 'Original submission' : 'Coach reaffirmation'} · Attended</p>
        <p>Coach {revision.submittedById} · <time dateTime={revision.submittedAt}>{dateTime(revision.submittedAt)}</time></p>
        {revision.reviewDecision ? <>
          <p>Returned by Admin {revision.reviewDecision.adminId} · <time dateTime={revision.reviewDecision.decidedAt}>
            {dateTime(revision.reviewDecision.decidedAt)}</time></p>
          <p><strong>Return reason:</strong> {revision.reviewDecision.reason}</p>
        </> : <p>Pending review</p>}
      </li>)}
    </ol> : <p>No attendance history.</p>)}
    {history?.nextCursor && <button className="button secondary" disabled={busy}
      onClick={() => void load(history.nextCursor!)}>Load earlier revisions</button>}
    {!enabled && <p>Attendance changes are currently unavailable for this participant.</p>}
    {enabled && !coach && pending && <form onSubmit={event => {
      event.preventDefault();
      if (!reason.trim() || busy || retry) return;
      void save(newWrite(path + '/return', { expectedScheduleRevision: scheduleRevision, expectedRevision: item.revision, reason }));
    }}>
      <label>Reason for return (attendance only)
        <textarea required maxLength={1000} value={reason} disabled={busy || !!retry} onChange={event => setReason(event.target.value)} />
      </label>
      <button className="button primary" disabled={busy || !!retry || !reason.trim()}>Return to Coach</button>
    </form>}
    {enabled && coach && returned && <form onSubmit={event => {
      event.preventDefault();
      if (!acknowledged || busy || retry || !latest.reviewDecision) return;
      void save(newWrite(path + '/reaffirm', { expectedScheduleRevision: scheduleRevision, expectedRevision: item.revision,
        reviewedReturnId: latest.reviewDecision.id, outcome: 'ATTENDED' }));
    }}>
      <p>This reaffirms Attended. Attendance details cannot be edited in this slice.</p>
      <label><input type="checkbox" checked={acknowledged} disabled={busy || !!retry}
        onChange={event => setAcknowledged(event.target.checked)} /> I have read the Admin’s return reason and reaffirm Attended.</label>
      <button className="button primary" disabled={busy || !!retry || !acknowledged}>Reaffirm Attended</button>
    </form>}
  </section>;
}
