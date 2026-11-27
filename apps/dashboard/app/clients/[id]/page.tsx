import Link from 'next/link';
import { cookies } from 'next/headers';
import { clientRoute, readClientRoute } from '../../../lib/client-relay';
import { accessCookie, api } from '../../../lib/session';
import { Icon } from '../../catalog/ui';
import { ClientReadError, ClientWorkspace } from '../ui';
import { OnboardingAdmin } from '../onboarding-admin';
import { ClientProfileEditor } from '../profile-editor';

export const metadata = { title: 'Client profile | Strength Studio', referrer: 'no-referrer' };

export default async function ClientProfile({ params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get(accessCookie)?.value;
  if (!token) return <ClientReadError status={401} />;
  const { id } = await params;
  if (clientRoute('GET', ['clients', id]) !== 'detail') return <ClientReadError status={404} />;
  const result = await readClientRoute('detail', 'clients/' + id, token, new URLSearchParams());
  if (!result.ok) return <ClientReadError status={result.status} retry={result.status >= 500 ? '/clients/' + id : undefined} />;
  const identity = await api('me', 'GET', { token }).catch(() => null);
  const account = identity?.ok ? await identity.json().catch(() => null) : null;
  if (!account) return <ClientReadError status={identity?.status === 401 ? 401 : 503} />;
  const client = result.data;
  return <ClientWorkspace detail>
    <Link className="button quiet back" href="/clients" prefetch={false}><Icon name="back" /> Back to clients</Link>
    <ClientProfileEditor key={client.id + ':' + account.id} initial={client} actorId={account.id} admin={account.role === 'ADMIN'} />
    {account.role === 'ADMIN' && <OnboardingAdmin key={'onboarding:' + client.id + ':' + account.id} actorId={account.id} clientId={client.id} />}
  </ClientWorkspace>;
}
