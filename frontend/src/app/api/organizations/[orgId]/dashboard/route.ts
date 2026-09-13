export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

type ActivityRow = { type: 'project' | 'task'; id: string; title: string; updatedAt: Date };

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { orgId } = await ctx.params;
    const auth = await requireOrgRole(orgId, 'MEMBER');
    if (auth instanceof NextResponse) return auth;

    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      activeProjectsCount,
      tasksInProgressCount,
      tasksDoneCount,
      memberCount,
      upcomingDeadlines,
      recentProjects,
      recentTasks,
      activeProjects,
    ] = await Promise.all([
      prisma.project.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
      prisma.task.count({ where: { organizationId: orgId, status: 'IN_PROGRESS' } }),
      prisma.task.count({ where: { organizationId: orgId, status: 'DONE' } }),
      prisma.organizationMember.count({ where: { organizationId: orgId } }),
      prisma.task.findMany({
        where: {
          organizationId: orgId,
          status: { not: 'DONE' },
          dueAt: { gte: now, lte: in7Days },
        },
        select: {
          id: true,
          title: true,
          dueAt: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: { dueAt: 'asc' },
        take: 10,
      }),
      prisma.project.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      prisma.task.findMany({
        where: { organizationId: orgId },
        select: { id: true, title: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      prisma.project.findMany({
        where: { organizationId: orgId, status: 'ACTIVE' },
        select: { id: true, name: true, tasks: { select: { status: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const recentActivity: ActivityRow[] = [
      ...recentProjects.map((p) => ({
        type: 'project' as const,
        id: p.id,
        title: p.name,
        updatedAt: p.updatedAt,
      })),
      ...recentTasks.map((t) => ({
        type: 'task' as const,
        id: t.id,
        title: t.title,
        updatedAt: t.updatedAt,
      })),
    ]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 10);

    const projectsProgress = activeProjects.map(({ tasks, ...p }) => ({
      id: p.id,
      name: p.name,
      total: tasks.length,
      done: tasks.filter((t) => t.status === 'DONE').length,
    }));

    return NextResponse.json(
      {
        activeProjectsCount,
        tasksInProgressCount,
        tasksDoneCount,
        memberCount,
        upcomingDeadlines,
        recentActivity,
        projectsProgress,
      },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
