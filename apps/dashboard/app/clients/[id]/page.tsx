import Link from 'next/link';
import { cookies } from 'next/headers';
import { clientRoute, readClientRoute } from '../../../lib/client-relay';
import { dateTime } from '../../../lib/catalog';
import { accessCookie } from '../../../lib/session';
import { Icon } from '../../catalog/ui';
import { ClientReadError, ClientStateBadge, ClientWorkspace } from '../ui';

export const metadata = { title: 'Client profile | Strength Studio', referrer: 'no-referrer' };

export default async function ClientProfile({ params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(accessCookie)?.value;
  if (!token) return <ClientReadError status={401} />;
  const { id } = await params;
  if (clientRoute('GET', ['clients', id]) !== 'detail') return <ClientReadError status={404} />;
  const result = await readClientRoute('detail', 'clients/' + id, token, new URLSearchParams());
  if (!result.ok) return <ClientReadError status={result.status} retry={result.status >= 500 ? '/clients/' + id : undefined} />;
  const client = result.data;
  return <ClientWorkspace detail>
    <Link className="button quiet back" href="/clients" prefetch={false}><Icon name="back" /> Back to clients</Link>
    <header className="section-heading"><div><h1>{client.displayName}</h1></div></header>
    <section className="panel client-summary" aria-labelledby="profile-heading">
      <h2 id="profile-heading">Account details</h2>
      <dl className="terms">
        <div><dt>Email</dt><dd>{client.email}</dd></div>
        <div><dt>Account state</dt><dd><ClientStateBadge state={client.accountState} /></dd></div>
        <div><dt>Email verified (Riyadh)</dt><dd>{client.emailVerifiedAt
          ? <time dateTime={client.emailVerifiedAt}>{dateTime(client.emailVerifiedAt)}</time> : 'Unverified'}</dd></div>
        <div><dt>Created (Riyadh)</dt><dd><time dateTime={client.createdAt}>{dateTime(client.createdAt)}</time></dd></div>
      </dl>
    </section>
  </ClientWorkspace>;
}
