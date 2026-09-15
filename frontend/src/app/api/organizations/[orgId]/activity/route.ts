export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface ActivityEntry {
  id: string;
  type: 'project' | 'task' | 'calendar_event' | 'document' | 'message' | 'note' | 'member';
  actorName: string;
  description: string;
  createdAt: Date;
}

function displayName(actor: { name: string | null; email: string }): string {
  return actor.name ?? actor.email;
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

    const [projects, tasks, calendarEvents, documents, messages, notes, members] =
      await Promise.all([
        prisma.project.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            name: true,
            createdAt: true,
            createdBy: { select: { name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.task.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            title: true,
            createdAt: true,
            createdBy: { select: { name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.calendarEvent.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            title: true,
            createdAt: true,
            createdBy: { select: { name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.document.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            createdAt: true,
            uploadedBy: { select: { name: true, email: true } },
            fileUpload: { select: { filename: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.message.findMany({
          where: { organizationId: orgId },
          select: { id: true, createdAt: true, author: { select: { name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.note.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            title: true,
            createdAt: true,
            author: { select: { name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.organizationMember.findMany({
          where: { organizationId: orgId },
          select: { id: true, createdAt: true, user: { select: { name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      ]);

    const entries: ActivityEntry[] = [
      ...projects.map((p) => ({
        id: `project:${p.id}`,
        type: 'project' as const,
        actorName: displayName(p.createdBy),
        description: `a créé le projet « ${p.name} »`,
        createdAt: p.createdAt,
      })),
      ...tasks.map((t) => ({
        id: `task:${t.id}`,
        type: 'task' as const,
        actorName: displayName(t.createdBy),
        description: `a créé la tâche « ${t.title} »`,
        createdAt: t.createdAt,
      })),
      ...calendarEvents.map((e) => ({
        id: `calendar_event:${e.id}`,
        type: 'calendar_event' as const,
        actorName: displayName(e.createdBy),
        description: `a ajouté l'événement « ${e.title} » au calendrier`,
        createdAt: e.createdAt,
      })),
      ...documents.map((d) => ({
        id: `document:${d.id}`,
        type: 'document' as const,
        actorName: displayName(d.uploadedBy),
        description: `a ajouté le fichier « ${d.fileUpload.filename} »`,
        createdAt: d.createdAt,
      })),
      ...messages.map((m) => ({
        id: `message:${m.id}`,
        type: 'message' as const,
        actorName: displayName(m.author),
        description: 'a posté un message',
        createdAt: m.createdAt,
      })),
      ...notes.map((n) => ({
        id: `note:${n.id}`,
        type: 'note' as const,
        actorName: displayName(n.author),
        description: `a créé la note « ${n.title} »`,
        createdAt: n.createdAt,
      })),
      ...members.map((m) => ({
        id: `member:${m.id}`,
        type: 'member' as const,
        actorName: displayName(m.user),
        description: 'a rejoint l’équipe',
        createdAt: m.createdAt,
      })),
    ];

    entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return NextResponse.json(
      { activity: entries.slice(0, 30) },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
