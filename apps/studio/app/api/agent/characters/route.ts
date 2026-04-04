import { type NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;
import { generateCharacters } from "@/src/lib/agent/service";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { outline } = body as {
    outline?: {
      title: string;
      background: string;
      conflict: string;
      episodes: { title: string; script: string }[];
    };
  };

  if (!outline) {
    return NextResponse.json({ message: "outline is required" }, { status: 400 });
  }

  const result = await generateCharacters({ outline });
  return result.toTextStreamResponse();
}
