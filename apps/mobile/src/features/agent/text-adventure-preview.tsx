import type { TextAdventureSession } from "./api/text-adventure-api";
import { TextAdventurePlayer } from "./text-adventure-player";
/** Library and editor entry points share the same durable session recovery. */
export function TextAdventurePreview({
  gameId,
  session,
  onBack,
}: {
  gameId: string;
  session: TextAdventureSession;
  onBack: () => void;
}) {
  return (
    <TextAdventurePlayer
      key={`${gameId}:${session.userId}:${session.generation}`}
      gameId={gameId}
      account={session}
      onBack={onBack}
      backLabel="textAdventures.actions.backToLibrary"
    />
  );
}
