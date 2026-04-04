import { type NextRequest, NextResponse } from "next/server";

export const maxDuration = 180;
import { generateStoryboard } from "@/src/lib/agent/service";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { outline, characters, scenes } = body as {
    outline?: {
      title: string;
      videoStyle: string;
      aspectRatio: string;
      episodes: { title: string; script: string }[];
    };
    characters?: { name: string; appearance: string }[];
    scenes?: { name: string; description: string }[];
  };

  if (!outline || !characters || !scenes) {
    return NextResponse.json(
      { message: "outline, characters, and scenes are required" },
      { status: 400 }
    );
  }

  const result = await generateStoryboard({ outline, characters, scenes });
  return result.toTextStreamResponse();
}
