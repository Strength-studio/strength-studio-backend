'use client';

import { FormEvent, useRef, useState } from 'react';
import {
  CatalogError, CatalogWrite, currentVersion, DraftVersion, errorText, newWrite, PackageDetail, packageDetail,
  pricePattern, SessionType, Terms, write,
} from '../../lib/catalog';
import { Modal, VersionDates, VersionTerms } from './ui';

export type Action =
  | { kind: 'create' }
  | { kind: 'clone' | 'edit' | 'publish'; offer: PackageDetail; version: DraftVersion }
  | { kind: 'archive'; offer: PackageDetail }
  | { kind: 'createType' }
  | { kind: 'archiveType'; sessionType: SessionType };

const titles = {
  create: 'Create package', clone: 'Create successor draft', edit: 'Edit draft', publish: 'Publish version',
  archive: 'Archive package', createType: 'Create session type', archiveType: 'Archive session type',
};
const labels = {
  create: 'Create draft', clone: 'Create draft', edit: 'Save draft', publish: 'Publish version',
  archive: 'Archive package', createType: 'Create session type', archiveType: 'Archive session type',
};
const done = {
  create: 'Package draft created.', clone: 'Successor draft created.', edit: 'Draft saved.', publish: 'Version published.',
  archive: 'Package archived.', createType: 'Session type created.', archiveType: 'Session type archived.',
};

function TermsFields({ initial, types }: { initial?: DraftVersion; types: SessionType[] | null }) {
  const [kind, setKind] = useState<Terms['kind']>(initial?.kind ?? 'TIME');
  const [selected, setSelected] = useState(() => initial?.sessionTypes.map(type => type.id)
    .filter(id => types?.some(type => type.id === id)) ?? []);
  return <>
    <label>Package name<input name="name" defaultValue={initial?.name} maxLength={120} required autoFocus={!!initial} /></label>
    <label>Description<textarea name="description" defaultValue={initial?.description} maxLength={2000} rows={3} /></label>
    <div className="form-grid">
      <label>Price in SAR<input name="price" defaultValue={initial?.price} required
        pattern={pricePattern} maxLength={18} inputMode="decimal" placeholder="150.00" aria-describedby="price-help" />
        <small id="price-help">Up to 15 whole digits and two decimal places.</small></label>
      <label>Package kind<select name="kind" value={kind} onChange={event => setKind(event.target.value as Terms['kind'])}>
        <option value="TIME">TIME</option><option value="SESSION">SESSION</option></select></label>
      <label>Validity in days<input name="validityDays" type="number" min="1" max="2147483647" step="1"
        required defaultValue={initial?.validityDays} /></label>
      {kind === 'SESSION' && <label>Session allowance<input name="sessionAllowance" type="number"
        min="1" max="2147483647" step="1" required defaultValue={initial?.sessionAllowance ?? ''} /></label>}
    </div>
    <fieldset className="type-options"><legend>Eligible session types</legend>
      {types === null ? <p className="muted">Active types are unavailable. {initial
        ? 'Existing eligibility stays unchanged.' : 'You can save a draft and add eligible types later.'}</p>
        : types.length ? <div className="checklist">{types.map(type => {
          const checked = selected.includes(type.id);
          return <label className="check" key={type.id}><input type="checkbox" name="sessionTypeIds" value={type.id}
            checked={checked} disabled={!checked && selected.length >= 50}
            onChange={event => setSelected(items => event.target.checked ? [...items, type.id] : items.filter(id => id !== type.id))} />
            <span>{type.name}<small>{type.mode === 'GROUP' ? 'Group' : 'Individual'}</small></span></label>;
        })}</div> : <p className="muted">No active session types. Add one in Session types before publishing.</p>}
      {types && initial?.sessionTypes.some(type => !types.some(active => active.id === type.id)) &&
        <p className="muted">Archived types remain in issued history. They are excluded from this draft selection.</p>}
      {types && <small className="muted">{selected.length} of 50 selected. Publication requires at least one active type.</small>}
    </fieldset>
  </>;
}

function formTerms(data: FormData, types: SessionType[] | null): Terms {
  const name = String(data.get('name') ?? '').trim();
  const kind = data.get('kind') === 'SESSION' ? 'SESSION' : 'TIME';
  if (!name) throw new Error('Enter a package name.');
  return {
    name, description: String(data.get('description') ?? ''), price: String(data.get('price')), kind,
    validityDays: Number(data.get('validityDays')), sessionAllowance: kind === 'SESSION' ? Number(data.get('sessionAllowance')) : null,
    ...(types ? { sessionTypeIds: data.getAll('sessionTypeIds').map(String) } : {}),
  };
}

function termChanges(terms: Terms, original: DraftVersion) {
  const { sessionTypeIds, ...fields } = terms;
  const changes: Record<string, Terms[keyof Terms]> = Object.fromEntries(Object.entries(fields).filter(([key, value]) => {
    if (key === 'price') {
      const [whole, fraction = ''] = terms.price.split('.');
      return whole + '.' + fraction.padEnd(2, '0') !== original.price;
    }
    return value !== original[key as keyof typeof fields];
  }));
  if (sessionTypeIds && [...sessionTypeIds].sort().join() !== original.sessionTypes.map(type => type.id).sort().join()) {
    changes.sessionTypeIds = sessionTypeIds;
  }
  if (!Object.keys(changes).length) throw new Error('Change at least one draft field before saving.');
  return changes;
}

export function CatalogDialog({ action, types, onClose, onComplete, onExpired }: {
  action: Action; types: SessionType[] | null; onClose: (refresh: boolean) => void;
  onComplete: (notice: string, packageId?: string) => void; onExpired: () => void;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<CatalogWrite>();
  const [conflict, setConflict] = useState<PackageDetail>();
  const [blocked, setBlocked] = useState(false);
  const [base, setBase] = useState(action.kind === 'edit' ? action.version : undefined);
  const [formSeed, setFormSeed] = useState(base);
  const [formGeneration, setFormGeneration] = useState(0);
  const offer = 'offer' in action ? action.offer : undefined;
  const current = offer && currentVersion(offer);
  const latestVersion = conflict && 'version' in action && conflict.versions.find(version => version.id === action.version.id);
  const newestDraft = latestVersion && !latestVersion.publishedAt ? latestVersion : undefined;

  async function execute(intent: CatalogWrite) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setRetry(undefined);
    try {
      const result = await write(intent);
      onComplete(done[action.kind], result.packageId);
    } catch (failure) {
      setError(errorText(failure));
      if (failure instanceof CatalogError) {
        if (failure.status === 401) onExpired();
        if (failure.status === 503) setRetry(intent);
        if (failure.status === 409 && offer) {
          setBlocked(true);
          try { setConflict(await packageDetail(offer.id)); }
          catch (refreshError) {
            if (refreshError instanceof CatalogError && refreshError.status === 401) onExpired();
            setError(errorText(failure) + ' The latest state could not be loaded here.');
          }
        }
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || blocked || retry) return;
    const data = new FormData(event.currentTarget);
    const packagePath = offer ? 'packages/' + offer.id : '';
    const code = String(data.get('code') ?? '').trim().toUpperCase();
    const reason = String(data.get('reason') ?? '').trim();
    let intent: CatalogWrite;
    try {
      switch (action.kind) {
        case 'create':
          intent = newWrite('packages', { code, ...formTerms(data, types), sessionTypeIds: data.getAll('sessionTypeIds').map(String) });
          break;
        case 'clone':
          intent = newWrite(packagePath + '/versions', {
            expectedCurrentVersionId: action.version.id, terms: types ? formTerms(data, types) : null,
          });
          break;
        case 'edit':
          intent = newWrite(packagePath + '/versions/' + action.version.id, {
            ...termChanges(formTerms(data, types), formSeed!), expectedDraftRevision: base!.draftRevision,
          }, 'PATCH');
          break;
        case 'publish':
          intent = newWrite(packagePath + '/versions/' + action.version.id + '/publish', {
            expectedCurrentVersionId: current?.id ?? null, expectedDraftRevision: action.version.draftRevision,
          });
          break;
        case 'archive':
          if (!reason) throw new Error('Enter a reason for archiving this package.');
          intent = newWrite(packagePath + '/archive', { expectedCurrentVersionId: current?.id ?? null, reason });
          break;
        case 'createType': {
          const name = String(data.get('name') ?? '').trim();
          if (!name) throw new Error('Enter a session-type name.');
          intent = newWrite('session-types', { code, name, mode: data.get('mode') });
          break;
        }
        case 'archiveType':
          intent = newWrite('session-types/' + action.sessionType.id + '/archive', reason ? { reason } : {});
          break;
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Check the form values.');
      return;
    }
    void execute(intent);
  }

  function acceptRevision(keepEdits: boolean) {
    if (!newestDraft || conflict?.archivedAt) return;
    setBase(newestDraft);
    if (!keepEdits) {
      setFormSeed(newestDraft);
      setFormGeneration(value => value + 1);
    }
    setBlocked(false);
    setConflict(undefined);
    setError(keepEdits ? 'Your entries were kept. Review them, then save to apply them to the latest revision.' : '');
  }

  const isTerms = action.kind === 'create' || action.kind === 'edit' || (action.kind === 'clone' && types !== null);
  return <Modal title={titles[action.kind]} busy={busy} close={() => onClose(blocked)}>
    <form onSubmit={submit}>
      <fieldset className="dialog-body" disabled={busy}>
        {(action.kind === 'create' || action.kind === 'createType') &&
          <label>{action.kind === 'create' ? 'Package code' : 'Session-type code'}
            <input name="code" required autoFocus maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9_\-]{0,39}" placeholder="FOUNDATION-10" />
            <small>Letters, numbers, underscores and hyphens. Codes cannot be changed.</small>
          </label>}
        {action.kind === 'edit' && <p className="muted">Version {action.version.version} · Draft revision {base?.draftRevision}</p>}
        {action.kind === 'clone' && <p className="muted">Based on published version {action.version.version}.
          {types === null && ' The new draft copies its terms and eligibility.'}</p>}
        {isTerms && <TermsFields key={formGeneration} types={types}
          initial={action.kind === 'edit' ? formSeed : action.kind === 'clone' ? action.version : undefined} />}
        {action.kind === 'publish' && <div className="confirm-summary">
          <p>Publication freezes the issued terms. Future changes require a new version.</p>
          <p className="muted">{current ? 'This will supersede version ' + current.version + '.' : 'This will be the first published version.'}</p>
          <h3>{action.version.name} · v{action.version.version}</h3>
          <VersionDates version={action.version} /><VersionTerms version={action.version} />
        </div>}
        {action.kind === 'archive' && <>
          <p><strong>{action.offer.code}</strong> will leave the public catalog. Its versions and audit history will remain available in management.</p>
          {current && <p className="muted">Current published version {current.version}</p>}
          <label>Reason<textarea name="reason" maxLength={240} required rows={3} autoFocus /></label>
        </>}
        {action.kind === 'createType' && <>
          <label>Name<input name="name" required maxLength={120} /></label>
          <label>Mode<select name="mode"><option value="INDIVIDUAL">INDIVIDUAL</option><option value="GROUP">GROUP</option></select></label>
        </>}
        {action.kind === 'archiveType' && <>
          <p><strong>{action.sessionType.name}</strong> will no longer be selectable or eligible for new publication. Issued versions retain its label.</p>
          <label>Reason (optional)<textarea name="reason" maxLength={240} rows={3} autoFocus /></label>
        </>}
      </fieldset>
      {error && <div className={'notice ' + (error.startsWith('Your entries') ? 'info' : 'error')} role="status">{error}</div>}
      {conflict && <div className="conflict">
        <h3>Latest server state</h3>
        <p>{conflict.archivedAt ? 'Package archived.' : currentVersion(conflict)
          ? 'Current published version ' + currentVersion(conflict)!.version + '.' : 'No published version.'}</p>
        {latestVersion && <><VersionDates version={latestVersion} /><VersionTerms version={latestVersion} /></>}
        {action.kind === 'edit' && newestDraft && !conflict.archivedAt && <div className="button-row">
          <button type="button" className="button quiet" onClick={() => acceptRevision(false)}>Load latest draft</button>
          <button type="button" className="button secondary" onClick={() => acceptRevision(true)}>Keep my edits</button>
        </div>}
      </div>}
      <footer className="dialog-footer">
        <button type="button" className="button quiet" disabled={busy} onClick={() => onClose(blocked)}>{blocked ? 'Close and review' : 'Cancel'}</button>
        {retry && <button type="button" className="button secondary" disabled={busy} onClick={() => void execute(retry)}>Retry same request</button>}
        <button type="submit" className={'button ' + (action.kind === 'archive' || action.kind === 'archiveType' ? 'danger' : 'primary')}
          disabled={busy || blocked || !!retry}>{busy ? 'Working…' : labels[action.kind]}</button>
      </footer>
    </form>
  </Modal>;
}
