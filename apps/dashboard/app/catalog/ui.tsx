'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { CatalogError, DraftVersion, errorText, dateTime, money, Version } from '../../lib/catalog';

const paths = {
  boxes: 'M4 8l8-4 8 4-8 4-8-4zm0 0v8l8 4 8-4V8m-8 4v8',
  layers: 'M3 10l9-5 9 5-9 5-9-5zm0 5l9 5 9-5',
  grid: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-4.3-4.3M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  archive: 'M4 9h16v11H4zM3 5h18v4H3zm7 8h4',
  file: 'M6 3h8l4 4v14H6zm8 0v5h5M9 13h6m-6 4h6',
  check: 'm5 12 4 4L19 6',
  chevron: 'm9 6 6 6-6 6',
  back: 'M20 12H4m7-7-7 7 7 7',
  close: 'm6 6 12 12M6 18 18 6',
  exit: 'M11 4H5v16h6m3-12 4 4-4 4m4-4H9',
  spark: 'M12 2v5m0 10v5M2 12h5m10 0h5M5 5l3 3m8 8 3 3m0-14-3 3m-8 8-3 3',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  refresh: 'M20 7v5h-5M4 17v-5h5m-4-1a7 7 0 0 1 12-5l3 5m-16 2 3 5a7 7 0 0 0 12-5',
} as const;

export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function useRead<T>(load: () => Promise<T>, onExpired: () => void) {
  const [result, setResult] = useState<{ value?: T; error?: unknown }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setResult({});
    load().then(value => { if (active) setResult({ value }); }, error => {
      if (!active) return;
      if (error instanceof CatalogError && error.status === 401) onExpired();
      setResult({ error });
    });
    return () => { active = false; };
  }, [load, onExpired, attempt]);
  return { ...result, reload: () => setAttempt(value => value + 1) };
}

export function ReadState({ error, onRetry, label = 'Loading catalog…' }: { error?: unknown; onRetry: () => void; label?: string }) {
  return error ? <div className="notice error" role="alert"><p>{errorText(error)}</p>
    <button type="button" className="button quiet" onClick={onRetry}>Try again</button></div>
    : <div className="empty" role="status"><span className="spinner" />{label}</div>;
}

export function Badge({ status }: { status: 'Published' | 'Draft' | 'Superseded' | 'Archived' }) {
  return <span className={'badge ' + status.toLowerCase()}>{status}</span>;
}

export function versionStatus(version: DraftVersion, archived: boolean) {
  return !version.publishedAt ? 'Draft' : version.supersededAt ? 'Superseded' : archived ? 'Archived' : 'Published';
}

export function VersionTerms({ version }: { version: Version }) {
  return <>
    {version.description && <p className="description">{version.description}</p>}
    <dl className="terms">
      <div><dt>Price</dt><dd>{money(version.price)}</dd></div>
      <div><dt>Kind</dt><dd>{version.kind === 'SESSION' ? 'Session' : 'Time'}</dd></div>
      <div><dt>Validity</dt><dd>{version.validityDays} days</dd></div>
      {version.sessionAllowance !== null && <div><dt>Allowance</dt><dd>{version.sessionAllowance} sessions</dd></div>}
    </dl>
    <p className="type-label">Eligible session types</p>
    {version.sessionTypes.length ? <div className="chips">{version.sessionTypes.map(type =>
      <span className="chip" key={type.id}>{type.name}</span>)}</div> : <p className="muted">None selected</p>}
  </>;
}

export function VersionDates({ version }: { version: DraftVersion }) {
  return <p className="version-dates"><Icon name="clock" size={14} />
    {version.publishedAt ? 'Published ' + dateTime(version.publishedAt) : 'Draft revision ' + version.draftRevision}
    {version.supersededAt && ' · Superseded ' + dateTime(version.supersededAt)}
    {version.publishedAt && ' · Riyadh'}
  </p>;
}

export function Modal({ title, busy, close, children }: { title: string; busy: boolean; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className="dialog" aria-labelledby="action-title"
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <header className="dialog-header"><div><span className="eyebrow">Catalog workspace</span><h2 id="action-title">{title}</h2></div>
      <button type="button" className="icon-button" aria-label="Close dialog" disabled={busy} onClick={close}><Icon name="close" /></button>
    </header>
    {children}
  </dialog>;
}
