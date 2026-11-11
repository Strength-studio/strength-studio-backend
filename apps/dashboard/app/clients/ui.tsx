import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '../catalog/ui';

export const stateLabels = {
  ACTIVE: 'Active',
  INVITED: 'Invited',
  PENDING_VERIFICATION: 'Pending verification',
  DISABLED: 'Disabled',
};

export function ClientStateBadge({ state }: { state: keyof typeof stateLabels }) {
  return <span className={'badge ' + (state === 'ACTIVE' ? 'published' : state === 'DISABLED' ? '' : 'draft')}>
    {stateLabels[state]}
  </span>;
}

export function ClientWorkspace({ detail, children }: { detail?: boolean; children: ReactNode }) {
  return <div className="workspace">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="layers" size={23} /></span>
        <div><strong>Strength Studio</strong><span>Studio operations</span></div>
      </div>
      <nav aria-label="Studio navigation">
        <p className="eyebrow">Workspace</p>
        <Link href="/" prefetch={false}><Icon name="boxes" /> Catalog</Link>
        <Link href="/clients" prefetch={false} className="active" aria-current={detail ? undefined : 'page'}>
          <Icon name="users" /> Clients
        </Link>
      </nav>
      <div className="sidebar-foot"><span className="status-dot" /> Studio dashboard</div>
    </aside>
    <main className="workspace-main">
      <div className="topbar"><span className="breadcrumb">Studio <span>/</span> Clients
        {detail && <><span>/</span> Profile</>}
      </span></div>
      <div className="workspace-content">{children}</div>
    </main>
  </div>;
}

export function ClientReadError({ status, retry }: { status: number; retry?: string }) {
  const message = ({
    400: 'The search filters or page cursor are invalid.',
    401: 'Sign in to continue.',
    403: 'Your account does not have access to Client Management.',
    404: 'This client could not be found.',
    429: 'Too many requests. Wait a moment and try again.',
  })[status] ?? 'Client records could not be loaded.';
  return <main className="entry"><section className="panel entry-card">
    <h1>Clients</h1>
    <p className="notice error" role="alert">{message}</p>
    <div className="button-row">
      {retry && <a className="button secondary" href={retry}>{status === 400 ? 'Reset filters' : 'Try again'}</a>}
      <Link className="button quiet" href="/" prefetch={false}>Back to dashboard</Link>
    </div>
  </section></main>;
}
