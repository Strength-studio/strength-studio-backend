import { cookies } from 'next/headers';
import { accessCookie, api } from '../../../lib/session';
import { ClientReadError, ClientWorkspace } from '../ui';
import { OnboardingAdmin } from '../onboarding-admin';

export const metadata = { title: 'Invite Client | Strength Studio', referrer: 'no-referrer' };
export default async function InviteClient() {
  const token = (await cookies()).get(accessCookie)?.value;
  if (!token) return <ClientReadError status={401} />;
  const response = await api('me', 'GET', { token }).catch(() => null);
  if (!response?.ok) return <ClientReadError status={response?.status === 401 ? 401 : 503} />;
  const actor = await response.json();
  if (actor.role !== 'ADMIN') return <ClientReadError status={403} />;
  return <ClientWorkspace><OnboardingAdmin actorId={actor.id} /></ClientWorkspace>;
}
