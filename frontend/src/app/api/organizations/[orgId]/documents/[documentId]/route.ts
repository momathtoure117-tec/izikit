export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { destroyUpload } from '@/lib/server/upload/cloudinary-client';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; documentId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, documentId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        organizationId: true,
        uploadedById: true,
        fileUploadId: true,
        fileUpload: { select: { key: true } },
      },
    });

    if (!doc || doc.organizationId !== orgId) {
      return NextResponse.json(
        { error: 'DOCUMENT_NOT_FOUND', message: 'Document not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const isUploader = doc.uploadedById === auth.user.sub;
    const isAdminOrOwner = auth.orgMember.role === 'ADMIN' || auth.orgMember.role === 'OWNER';
    if (!isUploader && !isAdminOrOwner) {
      return NextResponse.json(
        {
          error: 'FORBIDDEN_NOT_OWNER',
          message: 'Only the uploader or an admin can delete this document',
        },
        { status: 403, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    try {
      await destroyUpload(doc.fileUpload.key);
    } catch (err) {
      log.warn('document.destroyUpload failed, continuing with DB delete', { err, documentId });
    }

    await prisma.document.delete({ where: { id: doc.id } });
    await prisma.fileUpload.delete({ where: { id: doc.fileUploadId } });

    return new NextResponse(null, { status: 204, headers: { 'x-request-id': reqCtx.requestId } });
  });
}
