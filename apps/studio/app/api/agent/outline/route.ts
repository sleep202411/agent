import { type NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;
import { generateOutline } from "@/src/lib/agent/service";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { prompt, text } = body as { prompt?: string; text?: string };

  if (!prompt && !text) {
    return NextResponse.json({ message: "prompt or text is required" }, { status: 400 });
  }

  const result = await generateOutline({ prompt, text });
  return result.toTextStreamResponse();
}
