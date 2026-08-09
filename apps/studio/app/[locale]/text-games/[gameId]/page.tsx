import { notFound } from "next/navigation";
import { TextGameWorkbench } from "../_components/text-game-workbench";

const TEXT_GAME_ID_PATTERN = /^tg_[A-Za-z0-9]{16}$/;

export default async function TextGameEditorPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  if (!TEXT_GAME_ID_PATTERN.test(gameId)) notFound();
  return <TextGameWorkbench gameId={gameId} />;
}
