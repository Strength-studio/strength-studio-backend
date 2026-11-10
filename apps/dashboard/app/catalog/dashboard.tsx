'use client';

import { useCallback, useState } from 'react';
import {
  Account, activeTypes, AuditEvent, capability, CatalogError, currentVersion, dateTime, errorText, get, money, Offer,
  PackageDetail, packageDetail, Page, pagedPath, SessionType, Version, zeroPrice,
} from '../../lib/catalog';
import { Action, CatalogDialog } from './actions';
import { Badge, Icon, ReadState, useRead, VersionDates, versionStatus, VersionTerms } from './ui';

type Expiry = { onExpired: () => void };
type Tab = 'manage' | 'published' | 'types';
const tabs = {
  manage: { name: 'Package catalog', icon: 'boxes' },
  published: { name: 'Published catalog', icon: 'grid' },
  types: { name: 'Session types', icon: 'layers' },
} as const;

function usePages<T>(load: (after?: string) => Promise<Page<T>>, onExpired: () => void) {
  const first = useRead(load, onExpired);
  const [extra, setExtra] = useState<Page<T>>();
  const [moreError, setMoreError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const cursor = extra ? extra.nextCursor : first.value?.nextCursor;
  async function loadMore() {
    if (!cursor || busy) return;
    setBusy(true);
    setMoreError(undefined);
    try {
      const next = await load(cursor);
      setExtra(previous => ({ items: [...(previous?.items ?? []), ...next.items], nextCursor: next.nextCursor }));
    } catch (error) {
      if (error instanceof CatalogError && error.status === 401) onExpired();
      setMoreError(error);
    } finally { setBusy(false); }
  }
  return { ...first, items: [...(first.value?.items ?? []), ...(extra?.items ?? [])], cursor, busy, moreError, loadMore };
}

function More({ cursor, busy, moreError, loadMore }: {
  cursor?: string | null; busy: boolean; moreError?: unknown; loadMore: () => void;
}) {
  return cursor && <div className="more">
    {moreError ? <p className="notice error" role="alert">{errorText(moreError)}</p> : null}
    <button className="button secondary" type="button" onClick={loadMore} disabled={busy}>{busy ? 'Loading…' : 'Load more'}</button>
  </div>;
}

function PageHeading({ eyebrow, title, description, children }: {
  eyebrow: string; title: string; description: string; children?: React.ReactNode;
}) {
  return <header className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>
    <p className="muted">{description}</p></div>{children}</header>;
}

async function overviewPage(after?: string): Promise<Page<PackageDetail>> {
  const page = await get<Page<Offer>>(pagedPath('packages/management', 8, after));
  return { items: await Promise.all(page.items.map(offer => packageDetail(offer.id))), nextCursor: page.nextCursor };
}

function PackageOverview({ onExpired, onOpen, onCreate, onRefresh }: Expiry & {
  onOpen: (id: string) => void; onCreate: () => void; onRefresh: () => void;
}) {
  const page = usePages(overviewPage, onExpired);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const rows = page.items.map(offer => ({
    offer, current: currentVersion(offer), draft: offer.versions.find(version => !version.publishedAt),
  }));
  const totals = {
    all: rows.length,
    published: rows.filter(row => row.current).length,
    drafts: rows.filter(row => !row.offer.archivedAt && row.draft).length,
    archived: rows.filter(row => row.offer.archivedAt).length,
  };
  const needle = search.trim().toLowerCase();
  const visible = rows.filter(({ offer, current, draft }) => {
    const matches = [offer.code, current?.name, draft?.name, offer.versions[0]?.name]
      .some(value => value?.toLowerCase().includes(needle));
    return matches && (filter === 'all' || (filter === 'published' && !!current)
      || (filter === 'drafts' && !offer.archivedAt && !!draft) || (filter === 'archived' && !!offer.archivedAt));
  });
  return <>
    <PageHeading eyebrow="Catalog management" title="Package catalog" description="Manage public packages, commercial terms, and version history.">
      <button type="button" className="button primary" onClick={onCreate}><Icon name="plus" /> New package</button>
    </PageHeading>
    {page.value ? <>
      <div className="metrics" aria-label="Loaded catalog totals">
        {([
          ['all', 'Packages loaded', 'boxes'], ['published', 'Published', 'check'], ['drafts', 'With drafts', 'file'], ['archived', 'Archived', 'archive'],
        ] as const).map(([key, label, icon]) => <div key={key} className="metric">
          <span className={'metric-icon ' + key}><Icon name={icon} /></span>
          <div><span>{label}</span><strong>{totals[key]}</strong></div>
        </div>)}
      </div>
      <section className="panel" aria-label="Packages">
        <header className="panel-heading"><div><h2>All packages</h2><p className="muted">Public catalog records and their latest activity.</p></div>
          <button className="icon-button" type="button" aria-label="Refresh packages" onClick={onRefresh}><Icon name="refresh" /></button>
        </header>
        <div className="filters">
          <label className="search"><Icon name="search" /><input aria-label="Search loaded packages" value={search}
            onChange={event => setSearch(event.target.value)} placeholder="Search loaded packages…" /></label>
          <label className="select-filter"><span className="sr-only">Filter by status</span>
            <select value={filter} onChange={event => setFilter(event.target.value)}>
              <option value="all">All statuses</option><option value="published">Published</option>
              <option value="drafts">With drafts</option><option value="archived">Archived</option>
            </select></label>
        </div>
        {visible.length ? <div className="table-wrap"><table>
          <thead><tr><th>Package</th><th>Kind</th><th>Published version</th><th>Price</th><th>Validity</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{visible.map(({ offer, current, draft }) => {
            const summary = current ?? draft ?? offer.versions[0];
            return <tr key={offer.id}>
              <td className="package-name"><div className="package-cell"><span className="row-icon"><Icon name="boxes" /></span><div>
                <button className="text-button" type="button" onClick={() => onOpen(offer.id)}>{summary?.name ?? offer.code}</button>
                <span className="code">{offer.code}</span></div></div></td>
              <td data-label="Kind">{summary?.kind ?? '—'}</td>
              <td data-label="Published version">{current ? 'v' + current.version : '—'}</td>
              <td data-label="Price" className="price">{summary ? money(summary.price) : '—'}</td>
              <td data-label="Validity">{summary ? summary.validityDays + ' days' : '—'}</td>
              <td data-label="Status"><div className="chips">
                <Badge status={offer.archivedAt ? 'Archived' : current ? 'Published' : 'Draft'} />
                {!offer.archivedAt && current && draft && <Badge status="Draft" />}
              </div></td>
              <td className="open-column"><button className="icon-button" type="button" aria-label={'Open ' + offer.code} onClick={() => onOpen(offer.id)}>
                <Icon name="chevron" /></button></td>
            </tr>;
          })}</tbody>
        </table></div> : <div className="empty"><Icon name="boxes" size={26} />
          <strong>{rows.length ? 'No matching packages' : 'No packages yet'}</strong>
          <span>{rows.length ? 'Change the search or load more packages.' : 'Create a package to start with its first draft.'}</span>
        </div>}
        <More {...page} />
      </section>
    </> : <ReadState error={page.error} onRetry={page.reload} />}
  </>;
}

function AuditHistory({ id, onExpired }: Expiry & { id: string }) {
  const load = useCallback(async (after?: string): Promise<Page<AuditEvent>> => {
    try { return await get(pagedPath('packages/' + id + '/management/audit', 12, after)); }
    catch (error) {
      if (error instanceof CatalogError && error.status === 403 && !after) return { items: [], nextCursor: null };
      throw error;
    }
  }, [id]);
  const page = usePages(load, onExpired);
  if (!page.items.length) return page.error ? <ReadState error={page.error} onRetry={page.reload} /> : null;
  return <section className="panel audit">
    <header className="panel-heading"><div><h2>Audit history</h2><p className="muted">Events for this package · Riyadh time</p></div>
      <span className="row-icon"><Icon name="file" /></span></header>
    {page.items.map(event => <article className="audit-event" key={event.id}>
      <div className="audit-title"><strong>{event.action.replace(/^CATALOG_/, '').replaceAll('_', ' ').toLowerCase()}</strong>
        <time dateTime={event.createdAt}>{dateTime(event.createdAt)}</time></div>
      <dl><div><dt>Actor ID</dt><dd>{event.actorId ?? 'System'}</dd></div>
        {event.requestId && <div><dt>Request ID</dt><dd>{event.requestId}</dd></div>}
        {event.reason && <div><dt>Reason</dt><dd>{event.reason}</dd></div>}
        {Object.entries(event.details).filter(([, value]) => value !== null).map(([key, value]) => <div key={key}>
          <dt>{key.replace(/([a-z])([A-Z])/g, '$1 $2')}</dt><dd>{Array.isArray(value) ? value.join(', ')
            : key === 'effectiveAt' && typeof value === 'string' ? dateTime(value) : value}</dd></div>)}</dl>
    </article>)}
    <More {...page} />
  </section>;
}

function PackageView({ id, admin, back, onAction, onExpired }: Expiry & {
  id: string; admin: boolean; back: () => void; onAction: (action: Action) => void;
}) {
  const load = useCallback(() => packageDetail(id), [id]);
  const { value: offer, error, reload } = useRead(load, onExpired);
  return <>
    <button type="button" className="button quiet back" onClick={back}><Icon name="back" /> Back to packages</button>
    {offer ? <>
      <PageHeading eyebrow={offer.code} title={currentVersion(offer)?.name ?? offer.versions[0]?.name ?? offer.code}
        description={offer.archivedAt ? 'Archived ' + dateTime(offer.archivedAt) + ' · Riyadh' : 'Issued terms and version history'}>
        <div className="button-row">
          {!offer.archivedAt && <>
            {currentVersion(offer) && <button className="button primary" type="button" onClick={() =>
              onAction({ kind: 'clone', offer, version: currentVersion(offer)! })}><Icon name="plus" /> New draft</button>}
            <button className="button secondary" type="button" onClick={() => onAction({ kind: 'archive', offer })}>
              <Icon name="archive" /> Archive package</button>
          </>}
          <button className="icon-button" type="button" aria-label="Refresh package" onClick={reload}><Icon name="refresh" /></button>
        </div>
      </PageHeading>
      <div className="detail-grid">
        <section className="version-stack" aria-label="Package versions">
          <div className="section-label"><h2>Version history</h2>{offer.archivedAt && <Badge status="Archived" />}</div>
          {offer.versions.map(version => {
            const current = currentVersion(offer);
            const status = versionStatus(version, !!offer.archivedAt);
            const editable = !offer.archivedAt && !version.publishedAt;
            const stale = version.basedOnVersionId !== (current?.id ?? null);
            const requiresAdmin = zeroPrice(version.price) && !admin;
            return <details key={version.id} className="panel version" open={status === 'Published' || status === 'Draft' || undefined}>
              <summary><span className="version-number">v{version.version}</span><strong>{version.name}</strong>
                <Badge status={status} /><Icon name="chevron" size={16} /></summary>
              <div className="version-body"><VersionDates version={version} /><VersionTerms version={version} />
                {editable && <>
                  {stale && <p className="muted">This draft is based on an older issued version. Create a successor from the current version to publish new terms.</p>}
                  {requiresAdmin && <p className="muted">An Admin must publish this zero-priced version.</p>}
                  <div className="button-row">
                    <button className="button secondary" type="button" onClick={() => onAction({ kind: 'edit', offer, version })}>Edit draft</button>
                    {!stale && !requiresAdmin && <button className="button primary" type="button" onClick={() =>
                      onAction({ kind: 'publish', offer, version })}>Publish…</button>}
                  </div>
                </>}
              </div>
            </details>;
          })}
        </section>
        <AuditHistory id={id} onExpired={onExpired} />
      </div>
    </> : <ReadState error={error} onRetry={reload} />}
  </>;
}

const publishedPage = (after?: string) => get<Page<Version & { code: string }>>(pagedPath('packages', 12, after));

function PublishedCatalog({ onExpired }: Expiry) {
  const page = usePages(publishedPage, onExpired);
  return <>
    <PageHeading eyebrow="Catalog browsing" title="Published catalog" description="Current public offers available to signed-in clients." />
    {!page.value ? <ReadState error={page.error} onRetry={page.reload} /> : page.items.length
      ? <div className="published-grid">{page.items.map(version => <article className="panel offer-card" key={version.id}>
        <div className="button-row"><span className="code">{version.code} · v{version.version}</span><Badge status="Published" /></div>
        <h2>{version.name}</h2><VersionTerms version={version} />
      </article>)}</div>
      : <div className="empty panel">There are no published packages yet.</div>}
    <More {...page} />
  </>;
}

function SessionTypesView({ onExpired, onAction }: Expiry & { onAction: (action: Action) => void }) {
  const types = useRead(activeTypes, onExpired);
  return <>
    <PageHeading eyebrow="Catalog settings" title="Session types" description="Manage the classifications available to new package drafts.">
      <button className="button primary" type="button" onClick={() => onAction({ kind: 'createType' })}><Icon name="plus" /> New session type</button>
    </PageHeading>
    {!types.value ? <ReadState error={types.error} onRetry={types.reload} label="Loading session types…" /> : <section className="panel">
      <header className="panel-heading"><div><h2>Active session types</h2><p className="muted">Archived types remain in issued package history.</p></div></header>
      {types.value.length ? <ul className="reference-list">{types.value.map(type => <li key={type.id}>
        <span className="row-icon"><Icon name="layers" /></span><div><strong>{type.name}</strong><span className="code">{type.code}</span></div>
        <span className="chip">{type.mode}</span>
        <button type="button" className="button secondary" aria-label={'Archive ' + type.name}
          onClick={() => onAction({ kind: 'archiveType', sessionType: type })}><Icon name="archive" /> Archive</button>
      </li>)}</ul> : <div className="empty">No active session types. Create one to prepare packages for publication.</div>}
    </section>}
  </>;
}

async function loadAccess() {
  const [manage, read] = await Promise.all([capability('packages/management?limit=1'), capability('packages?limit=1')]);
  return { manage, read };
}

export function CatalogDashboard({ account, busy, sessionNotice, onSignOut, onExpired }: Expiry & {
  account: Account; busy: boolean; sessionNotice: string; onSignOut: () => void;
}) {
  const admin = account.role === 'ADMIN';
  const access = useRead(loadAccess, onExpired);
  const read = !!access.value?.read;
  const manage = !!access.value?.manage;
  const [tab, setTab] = useState<Tab>('manage');
  const [selected, setSelected] = useState<string>();
  const [generation, setGeneration] = useState(0);
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<{ action: Action; types: SessionType[] | null }>();
  const loadTypes = useCallback(() => read && manage ? activeTypes() : Promise.resolve(null), [read, manage]);
  const types = useRead(loadTypes, onExpired);
  const visibleTabs: Tab[] = [...(manage ? ['manage' as const] : []), ...(read ? ['published' as const] : []),
    ...(admin && read && manage ? ['types' as const] : [])];
  const currentTab = visibleTabs.includes(tab) ? tab : visibleTabs[0];
  function changed(message: string, packageId?: string) {
    setDialog(undefined);
    setNotice(message);
    setGeneration(value => value + 1);
    if (packageId) setSelected(packageId);
    if (currentTab === 'types') types.reload();
  }
  const show = (action: Action) => { setNotice(''); setDialog({ action, types: types.value ?? null }); };
  const refresh = () => setGeneration(value => value + 1);
  return <div className="workspace">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="layers" size={23} /></span><div>
        <strong>Strength Studio</strong><span>Studio operations</span></div></div>
      <nav aria-label="Catalog navigation"><p className="eyebrow">Workspace</p>
        {visibleTabs.map(item => <button key={item} type="button" className={item === currentTab ? 'active' : ''}
          aria-current={item === currentTab ? 'page' : undefined} onClick={() => { setTab(item); setNotice(''); }}>
          <Icon name={tabs[item].icon} />{tabs[item].name}</button>)}
      </nav>
      <div className="sidebar-foot"><span className="status-dot" /> Studio dashboard</div>
    </aside>
    <main className="workspace-main">
      <div className="topbar"><span className="breadcrumb">Studio <span>/</span> {currentTab ? tabs[currentTab].name : 'Workspace'}</span>
        <div className="account"><span className="avatar">{account.email.charAt(0).toUpperCase()}</span>
          <div><strong>{account.email}</strong><small>{admin ? 'Admin' : 'Staff'}</small></div>
          <button type="button" className="icon-button" onClick={onSignOut} disabled={busy} aria-label="Sign out" title="Sign out">
            <Icon name="exit" /></button></div>
      </div>
      <div className="workspace-content">
        {sessionNotice && <div className="notice error" role="alert">{sessionNotice}</div>}
        {notice && <div className="notice success" role="status"><Icon name="check" />{notice}</div>}
        {currentTab === 'manage' && !read && <p className="notice info">Selecting active session types requires catalog read access.</p>}
        {currentTab === 'manage' && !!types.error && <div className="notice error" role="alert">
          <p>Active session types could not be loaded.</p><button type="button" className="button quiet"
            onClick={types.reload}>Retry session types</button>
        </div>}
        {!access.value ? <ReadState error={access.error} onRetry={access.reload} label="Checking catalog access…" />
          : !currentTab ? <div className="empty panel"><strong>No catalog access</strong>
            <span>Your account needs a catalog permission from an Admin.</span>
            <button type="button" className="button secondary" onClick={access.reload}>Check access again</button>
          </div>
          : currentTab === 'manage' ? selected
            ? <PackageView key={selected + ':' + generation} id={selected} admin={admin} onExpired={onExpired}
              back={() => { setSelected(undefined); setNotice(''); }} onAction={show} />
            : <PackageOverview key={generation} onExpired={onExpired} onOpen={id => { setSelected(id); setNotice(''); }}
              onCreate={() => show({ kind: 'create' })} onRefresh={() => { refresh(); types.reload(); }} />
          : currentTab === 'published' ? <PublishedCatalog onExpired={onExpired} />
          : <SessionTypesView key={generation} onExpired={onExpired} onAction={show} />}
      </div>
    </main>
    {dialog && <CatalogDialog action={dialog.action} types={dialog.types} onExpired={onExpired} onComplete={changed}
      onClose={reload => { setDialog(undefined); if (reload) refresh(); }} />}
  </div>;
}
