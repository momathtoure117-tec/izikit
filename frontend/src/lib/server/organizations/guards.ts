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

/**
 * Is `userId` a member of `organizationId`?
 *
 * Task routes accept an `assigneeId` from the client. Without this check a well-formed but
 * foreign/nonexistent cuid reaches Postgres and blows up as an unhandled FK-constraint error
 * (a 500) — or, worse, silently assigns a task to someone outside the workspace. Callers turn
 * a `false` into a 400 ASSIGNEE_NOT_MEMBER.
 */
export async function isOrgMember(
  client: PrismaClient | Prisma.TransactionClient,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const row = await client.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { userId: true },
  });
  return row !== null;
}
