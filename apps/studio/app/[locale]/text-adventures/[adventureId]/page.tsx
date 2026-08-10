import { notFound } from "next/navigation";
import { TextAdventureWorkbench } from "../_components/text-adventure-workbench";

const TEXT_GAME_ID_PATTERN = /^tg_[A-Za-z0-9]{16}$/;

export default async function TextAdventureEditorPage({
  params,
}: {
  params: Promise<{ adventureId: string }>;
}) {
  const { adventureId } = await params;
  if (!TEXT_GAME_ID_PATTERN.test(adventureId)) notFound();
  return <TextAdventureWorkbench adventureId={adventureId} />;
}
