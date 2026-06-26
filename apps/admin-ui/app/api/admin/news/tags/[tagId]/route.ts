import { NextRequest } from "next/server";
import { updateAdminNewsTag, type AdminNewsTagSaveInput } from "@/lib/admin-news";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

// Update a 资讯 tag's labels / status. tagId is immutable.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tagId: string }> }
) {
  const session = await getAdminSession();
  if (!session) return Response.json({ error: "未登录" }, { status: 401 });
  const { tagId } = await params;
  try {
    const input = (await request.json()) as AdminNewsTagSaveInput;
    await updateAdminNewsTag(tagId, input);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "更新标签失败。" },
      { status: 502 }
    );
  }
}
