export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { zCuid } from '@/lib/server/zod-helpers';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const CreateBody = z.object({
  fileUploadId: zCuid,
  url: z.string().refine((v) => v.startsWith('https://res.cloudinary.com/'), {
    message: 'url must be a Cloudinary secure_url',
  }),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; projectId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId, projectId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json(
        { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const upload = await prisma.fileUpload.findUnique({
      where: { id: parsed.data.fileUploadId },
      select: { id: true, userId: true, filename: true, mimeType: true, sizeBytes: true },
    });
    if (!upload || upload.userId !== auth.user.sub) {
      return NextResponse.json(
        { error: 'UPLOAD_NOT_FOUND', message: 'Upload not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const existing = await prisma.document.findUnique({
      where: { fileUploadId: upload.id },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'ALREADY_ATTACHED', message: 'This upload is already attached to a project' },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const document = await prisma.document.create({
      data: {
        organizationId: orgId,
        projectId,
        fileUploadId: upload.id,
        url: parsed.data.url,
        uploadedById: auth.user.sub,
      },
      select: {
        id: true,
        url: true,
        createdAt: true,
        fileUpload: { select: { filename: true, mimeType: true, sizeBytes: true } },
      },
    });

    return NextResponse.json(
      { document },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string; projectId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId, projectId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json(
        { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const documents = await prisma.document.findMany({
      where: { organizationId: orgId, projectId },
      select: {
        id: true,
        url: true,
        createdAt: true,
        uploadedById: true,
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
