export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const documents = await prisma.document.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        url: true,
        createdAt: true,
        uploadedById: true,
        project: { select: { id: true, name: true } },
        fileUpload: { select: { filename: true, mimeType: true, sizeBytes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(
      { documents },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
