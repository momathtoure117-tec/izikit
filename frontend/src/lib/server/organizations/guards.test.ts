import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect } from 'vitest';
import { countOwners } from './guards';

describe('countOwners', () => {
  it('counts OWNER members in the given organization', async () => {
    prismaMock.organizationMember.count.mockResolvedValueOnce(2);
    const count = await countOwners(prismaMock, 'org_1');
    expect(count).toBe(2);
    expect(prismaMock.organizationMember.count).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', role: 'OWNER' },
    });
  });
});
