export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const PatchBody = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
});

async function loadNoteOr404(
  orgId: string,
  noteId: string,
  requestId: string,
): Promise<{ id: string; organizationId: string; authorId: string } | NextResponse> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true, organizationId: true, authorId: true },
  });
  if (!note || note.organizationId !== orgId) {
    return NextResponse.json(
      { error: 'NOTE_NOT_FOUND', message: 'Note not found' },
      { status: 404, headers: { 'x-request-id': requestId } },
    );
  }
  return note;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; noteId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, noteId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const note = await loadNoteOr404(orgId, noteId, reqCtx.requestId);
    if (note instanceof NextResponse) return note;

    const isAuthor = note.authorId === auth.user.sub;
    const isAdminOrOwner = auth.orgMember.role === 'ADMIN' || auth.orgMember.role === 'OWNER';
    if (!isAuthor && !isAdminOrOwner) {
      return NextResponse.json(
        { error: 'FORBIDDEN_NOT_OWNER', message: 'Only the author or an admin can edit this note' },
        { status: 403, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const updated = await prisma.note.update({
      where: { id: noteId },
      data: {
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
      },
      select: {
        id: true,
        title: true,
        body: true,
        authorId: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      { note: updated },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; noteId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, noteId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const note = await loadNoteOr404(orgId, noteId, reqCtx.requestId);
    if (note instanceof NextResponse) return note;

    const isAuthor = note.authorId === auth.user.sub;
    const isAdminOrOwner = auth.orgMember.role === 'ADMIN' || auth.orgMember.role === 'OWNER';
    if (!isAuthor && !isAdminOrOwner) {
      return NextResponse.json(
        {
          error: 'FORBIDDEN_NOT_OWNER',
          message: 'Only the author or an admin can delete this note',
        },
        { status: 403, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    await prisma.note.delete({ where: { id: noteId } });

    return NextResponse.json(
      { success: true },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
