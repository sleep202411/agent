import type { NextRequest } from "next/server";
import {
  adminFetch,
  adminForwardHeaders,
  adminUrlForRequest,
  adminUnavailableResponse,
  relayAdminResponse,
} from "@/lib/admin-route";
import { overlayCertificateCatalogue } from "@/lib/course-certificate-catalogue";
import { listAdminUserLevelDefinitions } from "@/lib/admin-user-levels";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ courseId: string }> };

async function forward(request: NextRequest, context: Context) {
  const { courseId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(courseId))
    return Response.json({ msg: "Invalid course ID." }, { status: 400 });
  try {
    let body: string | undefined;
    if (request.method === "PUT") {
      const input = (await request.json()) as Record<string, unknown>;
      // Forward only the two fields of this narrowly scoped command.
      if (
        !input ||
        !Number.isSafeInteger(input.expectedVersion) ||
        (input.certificateId !== null && !Number.isSafeInteger(input.certificateId))
      ) {
        return Response.json({ msg: "Invalid certificate mapping." }, { status: 400 });
      }
      body = JSON.stringify({
        certificateId: input.certificateId,
        expectedVersion: input.expectedVersion,
      });
    }
    const response = await adminFetch(
      request,
      adminUrlForRequest(request, `/academy/course-certificates/${encodeURIComponent(courseId)}`),
      {
        method: request.method,
        headers: adminForwardHeaders(request, { json: true }),
        body,
        cache: "no-store",
        redirect: "error",
      }
    );
    return relayAdminResponse(response, request.signal);
  } catch {
    return adminUnavailableResponse();
  }
}

export async function GET(request: NextRequest, context: Context) {
  const forwarded = await forward(request, context);
  if (!forwarded.ok) return forwarded;
  const payload = (await forwarded.json().catch(() => null)) as {
    code?: number;
    data?: { certificates?: { id: number; name: string }[] };
  } | null;
  if (!payload || payload.code !== 200 || !payload.data || typeof payload.data !== "object") {
    return Response.json(payload ?? { msg: "Invalid certificate mapping." }, {
      status: forwarded.status,
    });
  }
  const levels = await listAdminUserLevelDefinitions().catch(() => []);
  return Response.json({
    ...payload,
    data: overlayCertificateCatalogue(payload.data, levels),
  });
}

export const PUT = forward;
