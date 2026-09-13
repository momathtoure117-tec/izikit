import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Count OWNER-role members of an organization. Callers use this inside a
 * transaction (COUNT + mutation in the same tx) to prevent the race where
 * two concurrent demotions/removals both see count > 1 and both succeed,
 * leaving the organization with zero owners — mirrors the existing
 * last-SUPERADMIN guard in /api/admin/users/[id]/role.
 */
export async function countOwners(
  client: PrismaClient | Prisma.TransactionClient,
  organizationId: string,
): Promise<number> {
  return client.organizationMember.count({
    where: { organizationId, role: 'OWNER' },
  });
}
