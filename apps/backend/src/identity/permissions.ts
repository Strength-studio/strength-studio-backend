import { Role, StaffPermission } from '@prisma/client';

export type Action = 'account.self' | 'client.manage' | 'user.manage' | 'staff.grant.manage'
  | 'studio.configure' | 'membership.activate' | 'membership.activate_exception' | 'commission.read'
  | 'catalog.read' | 'catalog.manage' | 'audit.read' | 'purchase.accept_record' | 'payment.record' | 'payment.verify';

export const staffPermissions = new Map(
  Object.values(StaffPermission)
    .filter(value => value !== StaffPermission.MEMBERSHIP_ACTIVATE && value !== StaffPermission.PAYMENT_VERIFY)
    .map(value => [value.toLowerCase().replaceAll('_', '.'), value]),
);

const adminActions = new Set<Action>([
  'account.self', 'client.manage', 'user.manage', 'staff.grant.manage', 'studio.configure',
  'membership.activate', 'membership.activate_exception', 'commission.read',
  'catalog.read', 'catalog.manage', 'audit.read', 'purchase.accept_record', 'payment.record', 'payment.verify',
]);

const staffActions = new Set<Action>(['client.manage', 'catalog.read', 'catalog.manage', 'audit.read', 'payment.record']);

export function hasAction(role: Role, grants: StaffPermission[], action: Action): boolean {
  if (action === 'account.self') return Object.values(Role).includes(role);
  if (role === Role.ADMIN) return adminActions.has(action);
  if (role === Role.CLIENT) return action === 'catalog.read';
  if (role !== Role.STAFF || !staffActions.has(action)) return false;
  const permission = staffPermissions.get(action);
  return permission !== undefined && grants.includes(permission);
}
