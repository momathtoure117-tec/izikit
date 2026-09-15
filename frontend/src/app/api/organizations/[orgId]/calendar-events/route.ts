export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const CreateBody = z.object({
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().max(2000).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
});

const MonthQuery = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM')
  .transform((value) => {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    const [, yearStr, monthStr] = match ?? ['', '1970', '01'];
    return { year: Number(yearStr), month: Number(monthStr) };
  });

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

    const event = await prisma.calendarEvent.create({
      data: {
        organizationId: orgId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        startAt: new Date(parsed.data.startAt),
        endAt: parsed.data.endAt ? new Date(parsed.data.endAt) : null,
        createdById: auth.user.sub,
      },
      select: { id: true, title: true, description: true, startAt: true, endAt: true },
    });

    return NextResponse.json(
      { event },
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

    const monthParam = new URL(req.url).searchParams.get('month') ?? '';
    const parsed = MonthQuery.safeParse(monthParam);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'month must be YYYY-MM' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const { year, month } = parsed.data;
    const rangeStart = new Date(Date.UTC(year, month - 1, 1));
    const rangeEnd = new Date(Date.UTC(year, month, 1));

    const [events, tasks] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: { organizationId: orgId, startAt: { gte: rangeStart, lt: rangeEnd } },
        select: {
          id: true,
          title: true,
          description: true,
          startAt: true,
          endAt: true,
          createdById: true,
        },
        orderBy: { startAt: 'asc' },
      }),
      prisma.task.findMany({
        where: {
          organizationId: orgId,
          dueAt: { gte: rangeStart, lt: rangeEnd },
        },
        select: {
          id: true,
          title: true,
          dueAt: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: { dueAt: 'asc' },
      }),
    ]);

    return NextResponse.json(
      { events, taskDeadlines: tasks },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
