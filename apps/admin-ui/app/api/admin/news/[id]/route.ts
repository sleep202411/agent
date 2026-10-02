import { NextRequest } from "next/server";
import { deleteAdminNews, updateAdminNews, type AdminNewsSaveInput } from "@/lib/admin-news";
import { contentPermissionResponse } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

// Update — PUT /api/admin/news/{id} (matches the deployed @PutMapping; the Java
// doc text says POST, the controller code is the source of truth).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await contentPermissionResponse("news.write");
  if (denied) return denied;
  const { id } = await params;
  try {
    const input = (await request.json()) as AdminNewsSaveInput;
    await updateAdminNews(id, input);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "更新资讯失败。" },
      { status: 502 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await contentPermissionResponse("news.write");
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteAdminNews(id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "删除资讯失败。" },
      { status: 502 }
    );
  }
}
