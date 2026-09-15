export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { zCuid } from '@/lib/server/zod-helpers';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { isOrgMember } from '@/lib/server/organizations/guards';
import { createNotification } from '@/lib/server/notifications';
import { mentionNotification } from '@/lib/server/notifications/templates';
import { log } from '@/lib/server/observability/log';

const CreateBody = z.object({
  body: z.string().trim().min(1).max(4000),
  projectId: zCuid.optional(),
});

const MENTION_TOKEN = /@\[([^\]]+)\]\(([a-zA-Z0-9]+)\)/g;

const MAX_MENTIONS = 20;

function extractMentionedUserIds(body: string): { name: string; userId: string }[] {
  const matches = [...body.matchAll(MENTION_TOKEN)];
  const all = matches.map((m) => ({ name: m[1]!, userId: m[2]! }));
  const seen = new Set<string>();
  const deduped: { name: string; userId: string }[] = [];
  for (const mention of all) {
    if (seen.has(mention.userId)) continue;
    seen.add(mention.userId);
    deduped.push(mention);
    if (deduped.length >= MAX_MENTIONS) break;
  }
  return deduped;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    if (parsed.data.projectId) {
      const project = await prisma.project.findFirst({
        where: { id: parsed.data.projectId, organizationId: orgId },
        select: { id: true },
      });
      if (!project) {
        return NextResponse.json(
          { error: 'PROJECT_NOT_FOUND', message: 'Project not found' },
          { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
    }

    const message = await prisma.message.create({
      data: {
        organizationId: orgId,
        projectId: parsed.data.projectId ?? null,
        authorId: auth.user.sub,
        body: parsed.data.body,
      },
      select: {
        id: true,
        body: true,
        authorId: true,
        projectId: true,
        createdAt: true,
        author: { select: { name: true, email: true } },
      },
    });

    const authorDisplayName = message.author.name ?? message.author.email;
    const mentions = extractMentionedUserIds(parsed.data.body);
    for (const mention of mentions) {
      try {
        const stillMember = await isOrgMember(prisma, orgId, mention.userId);
        if (!stillMember) continue;
        await createNotification(
          prisma,
          mentionNotification(
            mention.userId,
            message.id,
            authorDisplayName,
            orgId,
            message.projectId,
          ),
        );
      } catch (err) {
        log.warn('mention notification failed, message still created', {
          err,
          messageId: message.id,
          mentionedUserId: mention.userId,
        });
      }
    }

    // The client never needs the author relation — omit it from the response
    // rather than exposing it, keeping the public response shape unchanged.
    const messageResponse = {
      id: message.id,
      body: message.body,
      authorId: message.authorId,
      projectId: message.projectId,
      createdAt: message.createdAt,
    };

    return NextResponse.json(
      { message: messageResponse },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const projectIdParam = new URL(req.url).searchParams.get('projectId');

    const rows = await prisma.message.findMany({
      where: { organizationId: orgId, projectId: projectIdParam ?? null },
      select: { id: true, body: true, authorId: true, projectId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const messages = rows.reverse();

    return NextResponse.json(
      { messages },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
