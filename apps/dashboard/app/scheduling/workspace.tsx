'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { activeTypes, CatalogError, CatalogWrite, dateTime, get, newWrite, Page, SessionType, write } from '../../lib/catalog';
import type { Coach, ScheduledSession, Settings } from '../../lib/scheduling';

const messages: Record<string, string> = {
  COACH_SCHEDULE_CONFLICT: 'This coach already has a session or a post-session buffer during that time.',
  COACH_NOT_ELIGIBLE: 'Select an active, verified coach.',
  SCHEDULED_SESSION_CHANGED: 'This session changed. Reload the schedule before editing it again.',
  SCHEDULED_SESSION_NOT_EDITABLE: 'Only upcoming, uncancelled sessions can be edited or cancelled.',
  SCHEDULE_START_IN_PAST: 'Choose a start time in the future.',
  SCHEDULING_SETTINGS_REQUIRED: 'Save scheduling settings for this session type first.',
  INVALID_GROUP_CAPACITY: 'Enter a positive capacity for a group session.',
  SESSION_TYPE_ARCHIVED: 'This session type has been archived.',
  IDEMPOTENCY_KEY_EXPIRED: 'This request expired. Reload to check whether it went through.',
};

type Filters = { from: string; until: string; coachId: string };
type Editor = { kind: 'create' } | { kind: 'edit' | 'cancel'; session: ScheduledSession };
const prefix = 'scheduling/';
const riyadhOffsetMs = 3 * 60 * 60_000;
const riyadhInput = (value: number) => new Date(value + riyadhOffsetMs).toISOString();
const offset = (localDateTime: string) => localDateTime + '+03:00';
function initialFilters(): Filters {
  return { from: riyadhInput(Date.now()).slice(0, 10), until: riyadhInput(Date.now() + 7 * 86_400_000).slice(0, 10), coachId: '' };
}

function schedulePath(filters: Filters, after?: string) {
  const query = new URLSearchParams({ from: offset(filters.from + 'T00:00'), until: offset(filters.until + 'T00:00') });
  if (filters.coachId) query.set('coachId', filters.coachId);
  if (after) query.set('after', after);
  return prefix + 'sessions?' + query;
}

export function ScheduleWorkspace() {
  const [filters, setFilters] = useState(initialFilters);
  const [types, setTypes] = useState<SessionType[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [settings, setSettings] = useState<Settings[]>([]);
  const [page, setPage] = useState<Page<ScheduledSession>>();
  const [settingId, setSettingId] = useState('');
  const [editor, setEditor] = useState<Editor>();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const pending = useRef<CatalogWrite | null>(null);
  const working = useRef(false);
  const type = types.find(item => item.id === settingId);
  const defaults = settings.find(item => item.sessionTypeId === settingId);

  const report = useCallback((failure: unknown) => {
    if (failure instanceof CatalogError) {
      if (failure.status === 401) {
        window.location.replace('/?session=expired');
        return;
      }
      if (failure.status === 403 && failure.code === 'FORBIDDEN') {
        setDenied(true);
        return;
      }
      setError(messages[failure.code] ?? (failure.status === 400 ? 'Check the scheduling fields and try again.'
        : 'Scheduling request failed. Try again.'));
      return;
    }
    setError('Scheduling is temporarily unavailable.');
  }, []);

  const load = useCallback(async (window: Filters) => {
    const [typeRows, coachRows, settingsRows, sessionPage] = await Promise.all([
      activeTypes(), get<Coach[]>(prefix + 'coaches'), get<Settings[]>(prefix + 'settings'),
      get<Page<ScheduledSession>>(schedulePath(window)),
    ]);
    setTypes(typeRows);
    setCoaches(coachRows);
    setSettings(settingsRows);
    setPage(sessionPage);
  }, []);

  useEffect(() => {
    void load(initialFilters()).catch(report).finally(() => setLoading(false));
  }, [load, report]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const next = { from: String(values.get('from')), until: String(values.get('until')), coachId: String(values.get('coachFilter')) };
    setLoading(true);
    setError('');
    try {
      await load(next);
      setFilters(next);
    } catch (failure) { report(failure); }
    finally { setLoading(false); }
  }

  async function more(after: string) {
    setLoading(true);
    setError('');
    try {
      const next = await get<Page<ScheduledSession>>(schedulePath(filters, after));
      setPage(current => ({ items: [...(current?.items ?? []), ...next.items], nextCursor: next.nextCursor }));
    } catch (failure) { report(failure); }
    finally { setLoading(false); }
  }

  async function save(path: string, method: 'POST' | 'PATCH', payload: object, feedback: string) {
    if (working.current) return;
    working.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (pending.current?.path !== path || pending.current.body !== JSON.stringify(payload)) {
        pending.current = newWrite(path, payload, method);
      }
      await write(pending.current);
      pending.current = null;
      setEditor(undefined);
      setNotice(feedback);
      await load(filters);
    } catch (failure) { report(failure); }
    finally { working.current = false; setSaving(false); }
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save(prefix + 'settings/' + settingId, 'PATCH', {
      durationMinutes: Number(form.get('durationMinutes')),
      bufferMinutes: Number(form.get('bufferMinutes')),
      groupCapacity: type?.mode === 'GROUP' ? Number(form.get('groupCapacity')) : null,
    }, 'Scheduling settings saved.');
  }

  function saveSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const form = new FormData(event.currentTarget);
    if (editor.kind === 'cancel') {
      void save(prefix + 'sessions/' + editor.session.id + '/cancel', 'POST',
        { expectedRevision: editor.session.revision, reason: String(form.get('reason')).trim() }, 'Session cancelled.');
      return;
    }
    const assignment = { coachId: String(form.get('coachId')), startsAt: offset(String(form.get('startsAt'))) };
    if (editor.kind === 'edit') {
      void save(prefix + 'sessions/' + editor.session.id, 'PATCH',
        { ...assignment, expectedRevision: editor.session.revision }, 'Session updated.');
    } else {
      void save(prefix + 'sessions', 'POST', { ...assignment, sessionTypeId: String(form.get('sessionTypeId')) }, 'Session scheduled.');
    }
  }

  if (denied) return <p className="notice error" role="alert">Your account does not have access to Scheduling.</p>;
  const busy = loading || saving;
  const editing = editor && 'session' in editor ? editor.session : undefined;
  const configured = types.filter(item => settings.some(row => row.sessionTypeId === item.id));
  return <>
    {loading && <p role="status">Loading schedule…</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <section className="panel schedule-panel" aria-labelledby="settings-heading">
      <h2 id="settings-heading">Scheduling settings</h2>
      <label>Session type
        <select value={settingId} onChange={event => setSettingId(event.target.value)} disabled={busy}>
          <option value="">Select a session type</option>
          {types.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {type && <form key={JSON.stringify([settingId, defaults])} onSubmit={saveSettings} aria-label="Scheduling settings">
        <div className="form-grid">
          <label>Duration (minutes)<input name="durationMinutes" type="number" min="1" max="2147483647" required defaultValue={defaults?.durationMinutes} disabled={busy} /></label>
          <label>Post-session buffer (minutes)<input name="bufferMinutes" type="number" min="0" max="2147483647" required defaultValue={defaults?.bufferMinutes ?? 0} disabled={busy} /></label>
          {type.mode === 'GROUP' && <label>Group capacity<input name="groupCapacity" type="number" min="1" max="2147483647" required defaultValue={defaults?.groupCapacity ?? undefined} disabled={busy} /></label>}
        </div>
        <button className="button primary" disabled={busy}>Save settings</button>
      </form>}
    </section>
    <section className="panel schedule-panel" aria-labelledby="sessions-heading">
      <div className="button-row">
        <h2 id="sessions-heading">Scheduled sessions</h2>
        <button className="button primary" type="button" disabled={busy || !configured.length || !coaches.length}
          onClick={() => { setError(''); setEditor({ kind: 'create' }); }}>Create session</button>
      </div>
      <form className="button-row" aria-label="Schedule filters" onSubmit={search}>
        <label>From (Riyadh)<input name="from" type="date" required defaultValue={filters.from} disabled={busy} /></label>
        <label>Until (exclusive)<input name="until" type="date" required defaultValue={filters.until} disabled={busy} /></label>
        <label>Coach<select name="coachFilter" defaultValue={filters.coachId} disabled={busy}>
          <option value="">All coaches</option>
          {coaches.map(coach => <option key={coach.id} value={coach.id}>{coach.displayName}</option>)}
        </select></label>
        <button className="button secondary" disabled={busy}>Apply filters</button>
      </form>
      {editor && <form key={editor.kind + (editing?.id ?? '')} className="schedule-editor" aria-label="Session editor" onSubmit={saveSession}>
        <h3>{editor.kind === 'cancel' ? 'Confirm cancellation' : editor.kind === 'edit' ? 'Edit session' : 'Create session'}</h3>
        {editor.kind === 'cancel' ? <label>Cancellation reason<textarea name="reason" required maxLength={500} disabled={busy} /></label> :
          <div className="form-grid">
            {editor.kind === 'create' && <label>Session type<select name="sessionTypeId" required disabled={busy} defaultValue="">
              <option value="">Select a session type</option>
              {configured.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>}
            <label>Assigned coach<select name="coachId" required disabled={busy} defaultValue={editing?.coach.id ?? ''}>
              <option value="">Select a coach</option>
              {coaches.map(coach => <option key={coach.id} value={coach.id}>{coach.displayName}</option>)}
            </select></label>
            <label>Start (Riyadh)<input name="startsAt" type="datetime-local" step="0.001" required disabled={busy}
              defaultValue={editing ? riyadhInput(Date.parse(editing.startsAt)).slice(0, -1) : undefined} /></label>
          </div>}
        <div className="button-row">
          <button className="button primary" disabled={busy}>{editor.kind === 'cancel' ? 'Cancel session' : 'Save session'}</button>
          <button className="button quiet" type="button" disabled={busy} onClick={() => { setEditor(undefined); setError(''); }}>Close</button>
        </div>
      </form>}
      {page?.items.length ? <div className="schedule-table"><table>
        <thead><tr><th>Session</th><th>Coach</th><th>Start and end (Riyadh)</th><th>Buffer</th><th>Capacity</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{page.items.map(session => {
          const editable = session.status === 'SCHEDULED' && Date.parse(session.startsAt) > Date.now();
          return <tr key={session.id}>
            <td>{session.sessionTypeName}</td><td>{session.coach.displayName}</td>
            <td>{dateTime(session.startsAt)}<br />{dateTime(session.endsAt)}</td>
            <td>{session.bufferMinutes} min</td><td>{session.capacity}</td><td>{session.status === 'CANCELLED' ? 'Cancelled' : 'Scheduled'}</td>
            <td><div className="button-row">
              <a className="button quiet" href={'/bookings?scheduledSessionId=' + session.id}>Bookings</a>
              <a className="button quiet" href={'/attendance?scheduledSessionId=' + session.id}>Review attendance</a>
              {editable && <>
                <button className="button quiet" type="button" disabled={busy} onClick={() => setEditor({ kind: 'edit', session })}>Edit</button>
                <button className="button quiet" type="button" disabled={busy} onClick={() => setEditor({ kind: 'cancel', session })}>Cancel</button>
              </>}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div> : page && <p className="muted">No sessions in this date range.</p>}
      {page?.nextCursor && <div><button className="button secondary" disabled={busy} onClick={() => void more(page.nextCursor!)}>Load more</button></div>}
    </section>
  </>;
}
