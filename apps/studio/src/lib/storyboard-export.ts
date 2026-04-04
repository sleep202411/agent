interface RawV1Body<T = unknown> {
  success?: boolean;
  code?: number | string;
  data?: T;
  msg?: string;
  message?: string;
}

async function v1Blob(path: string, init?: RequestInit): Promise<Blob> {
  const response = await fetch(`/v1${path}`, {
    credentials: "include",
    ...init,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.blob();
}

async function v1FormData<T>(path: string, formData: FormData, timeout = 600_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(`/aurora${path}`, {
      method: "POST",
      credentials: "include",
      body: formData,
      signal: controller.signal,
    });
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    throw new Error(isTimeout ? "请求超时" : "网络连接失败");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const body = (await response.json()) as RawV1Body<T>;
  const isSuccess = body.success === true || body.code === 200 || body.code === "SUCCESS";
  if (!isSuccess) {
    throw new Error(body.msg || body.message || "请求失败");
  }

  return (body.data ?? null) as T;
}

export function exportStoryboard(storyBoardId: string) {
  return v1Blob(`/api/user/shot/export/${storyBoardId}`, { method: "POST" });
}

export function downloadStoryboardTemplate(storyBoardId: string) {
  return v1Blob(`/api/user/shot/downloadTemplate/${storyBoardId}`, { method: "POST" });
}

export async function importStoryboardFile(storyBoardId: string, file: File, override = false) {
  const formData = new FormData();
  formData.append("file", file);
  return v1Blob(`/api/user/shot/import/${storyBoardId}/${override}`, {
    method: "POST",
    body: formData,
  });
}

export async function formatStoryboardExcel(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return v1FormData<string[][]>("/api/ai/chat/format/storyboard/excel", formData);
}
