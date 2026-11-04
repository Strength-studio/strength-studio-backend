import { Role, StaffPermission } from '@prisma/client';

export type Action = 'account.self' | 'client.manage' | 'user.manage' | 'staff.grant.manage'
  | 'studio.configure' | 'membership.activate' | 'membership.activate_exception' | 'commission.read';

export const staffPermissions = new Map(
  Object.values(StaffPermission).map(value => [value.toLowerCase().replaceAll('_', '.'), value]),
);

const adminActions = new Set<Action>([
  'account.self', 'client.manage', 'user.manage', 'staff.grant.manage', 'studio.configure',
  'membership.activate', 'membership.activate_exception', 'commission.read',
]);

export function hasAction(role: Role, grants: StaffPermission[], action: Action): boolean {
  if (action === 'account.self') return Object.values(Role).includes(role);
  if (role === Role.ADMIN) return adminActions.has(action);
  if (role !== Role.STAFF || !['client.manage', 'membership.activate'].includes(action)) return false;
  const permission = staffPermissions.get(action);
  return permission !== undefined && grants.includes(permission);
}
