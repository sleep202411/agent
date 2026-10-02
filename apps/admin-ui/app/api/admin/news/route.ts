import { NextRequest } from "next/server";
import { createAdminNews, type AdminNewsSaveInput } from "@/lib/admin-news";
import { contentPermissionResponse } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

// Create. Reads (list/detail/tags) are server-loaded in the page components;
// only mutations need a client-callable route. Gated on the admin-ui session;
// the Java 资讯 backend is then called with the server-only X-Admin-Api-Token.
export async function POST(request: NextRequest) {
  const denied = await contentPermissionResponse("news.write");
  if (denied) return denied;
  try {
    const input = (await request.json()) as AdminNewsSaveInput;
    const id = await createAdminNews(input);
    return Response.json({ id });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "新建资讯失败。" },
      { status: 502 }
    );
  }
}
