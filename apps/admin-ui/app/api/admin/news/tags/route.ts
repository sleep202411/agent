import { NextRequest } from "next/server";
import { createAdminNewsTag, type AdminNewsTagSaveInput } from "@/lib/admin-news";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

// Create a 资讯 tag. (The tag LIST is server-loaded via fetchAdminNewsTags.)
export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  try {
    const input = (await request.json()) as AdminNewsTagSaveInput;
    const id = await createAdminNewsTag(input);
    return Response.json({ id });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "新建标签失败。" },
      { status: 502 }
    );
  }
}
