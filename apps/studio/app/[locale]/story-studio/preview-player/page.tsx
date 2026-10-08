import { notFound } from "next/navigation";
import { AppearancePlayerWindow } from "../_components/appearance-design/appearance-player-window";

/** Internal window; receives its validated runtime from the authorized project preview. */
export default async function PreviewPlayerPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string | string[] }>;
}) {
  const { channel } = await searchParams;
  if (typeof channel !== "string" || channel.length === 0 || channel.length > 128) notFound();
  return <AppearancePlayerWindow channel={channel} />;
}
