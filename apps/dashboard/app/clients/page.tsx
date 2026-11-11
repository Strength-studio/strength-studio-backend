import Link from 'next/link';
import { cookies } from 'next/headers';
import { clientQuery, readClientRoute, clientStates } from '../../lib/client-relay';
import { accessCookie } from '../../lib/session';
import { dateTime } from '../../lib/catalog';
import { Icon } from '../catalog/ui';
import { ClientReadError, ClientStateBadge, ClientWorkspace, stateLabels } from './ui';

export const metadata = { title: 'Clients | Strength Studio', referrer: 'no-referrer' };

export default async function ClientDirectory({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = (await cookies()).get(accessCookie)?.value;
  if (!token) return <ClientReadError status={401} />;
  const input = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') {
      // Empty controls from the directory form mean there is no filter.
      if (['q', 'accountState', 'emailVerified'].includes(key) && !value.trim()) continue;
      input.append(key, value);
    } else {
      for (const item of value ?? []) input.append(key, item);
    }
  }
  const query = clientQuery('list', input);
  if (!query) return <ClientReadError status={400} retry="/clients" />;
  const result = await readClientRoute('list', 'clients', token, query);
  if (!result.ok) return <ClientReadError status={result.status}
    retry={result.status === 400 ? '/clients' : result.status >= 500 ? '/clients?' + query : undefined} />;
  const { items, nextCursor } = result.data;
  const firstPage = new URLSearchParams(query);
  firstPage.delete('after');
  const nextPage = new URLSearchParams(firstPage);
  if (nextCursor) nextPage.set('after', nextCursor);

  return <ClientWorkspace>
    <header className="section-heading"><div><h1>Clients</h1></div></header>
    <section className="panel" aria-labelledby="directory-heading">
      <header className="panel-heading"><h2 id="directory-heading">Client directory</h2></header>
      <form className="filters" action="/clients" method="get">
        <label className="search"><Icon name="search" />
          <input name="q" maxLength={120} aria-label="Search clients by name or email"
            placeholder="Search name or email…" defaultValue={query.get('q') ?? ''} />
        </label>
        <label><span className="sr-only">Account state</span>
          <select name="accountState" defaultValue={query.get('accountState') ?? ''}>
            <option value="">All account states</option>
            {clientStates.map(state => <option key={state} value={state}>{stateLabels[state]}</option>)}
          </select>
        </label>
        <label><span className="sr-only">Email verification</span>
          <select name="emailVerified" defaultValue={query.get('emailVerified') ?? ''}>
            <option value="">Any verification status</option>
            <option value="true">Verified email</option>
            <option value="false">Unverified email</option>
          </select>
        </label>
        {query.has('limit') && <input type="hidden" name="limit" value={query.get('limit')!} />}
        <button className="button secondary" type="submit">Apply</button>
        {['q', 'accountState', 'emailVerified'].some(key => query.has(key)) &&
          <Link className="button quiet" href="/clients" prefetch={false}>Clear filters</Link>}
      </form>
      {items.length ? <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Account state</th><th>Email verification</th><th>Created (Riyadh)</th></tr></thead>
        <tbody>{items.map(client => <tr key={client.id}>
          <td data-label="Name"><Link className="text-button" href={'/clients/' + client.id} prefetch={false}>{client.displayName}</Link></td>
          <td data-label="Email">{client.email}</td>
          <td data-label="Account state"><ClientStateBadge state={client.accountState} /></td>
          <td data-label="Email verification">{client.emailVerified ? 'Verified' : 'Unverified'}</td>
          <td data-label="Created (Riyadh)"><time dateTime={client.createdAt}>{dateTime(client.createdAt)}</time></td>
        </tr>)}</tbody>
      </table></div> : <div className="empty"><Icon name="users" size={25} /><strong>No matching clients</strong></div>}
      {(query.has('after') || nextCursor) && <nav className="more button-row" aria-label="Client directory pages">
        {query.has('after') && <Link className="button quiet" href={'/clients?' + firstPage} prefetch={false}>First page</Link>}
        {nextCursor && <Link className="button secondary" href={'/clients?' + nextPage} prefetch={false}>Next page</Link>}
      </nav>}
    </section>
  </ClientWorkspace>;
}
