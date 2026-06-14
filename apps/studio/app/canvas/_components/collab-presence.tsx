"use client";

import { ViewportPortal } from "@xyflow/react";
import type { Awareness } from "y-protocols/awareness";
import { cn } from "@/lib/utils";
import { useAwarenessPeers, type PeerPresence, type PeerUser } from "@/lib/collab/use-awareness";

interface PresenceProps {
  awareness: Awareness | null;
  localClientId: number | undefined;
}

/**
 * Live peer cursors, rendered in flow coordinates (ViewportPortal) so they pan
 * and zoom with the canvas. Per-user color is a deliberate functional exception
 * to the monochrome system (same rationale as the node port colors).
 */
export function CollabCursors({ awareness, localClientId }: PresenceProps) {
  const peers = useAwarenessPeers(awareness, localClientId);
  return (
    <ViewportPortal>
      {peers.map((peer) => (peer.cursor ? <PeerCursor key={peer.clientId} peer={peer} /> : null))}
    </ViewportPortal>
  );
}

function PeerCursor({ peer }: { peer: PeerPresence }) {
  const color = peer.user?.color ?? "#9ca3af";
  const name = peer.user?.name ?? "Guest";
  return (
    <div
      className="pointer-events-none absolute top-0 left-0 z-[1000] select-none"
      style={{
        transform: `translate(${peer.cursor!.x}px, ${peer.cursor!.y}px)`,
      }}
    >
      <svg width="20" height="22" viewBox="0 0 20 22" fill="none" className="drop-shadow">
        <path
          d="M5.5 3.21V20.79c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.36Z"
          fill={color}
          stroke="white"
          strokeWidth="1.2"
        />
      </svg>
      <span
        className="absolute top-4 left-4 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white shadow-sm"
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    </div>
  );
}

const MAX_AVATARS = 5;

/**
 * Active-user avatar group (top-right). Dedupes by user id so a person with
 * several tabs shows once. Renders nothing when no peers are present.
 */
export function CollabAvatars({
  awareness,
  localClientId,
  className,
}: PresenceProps & { className?: string }) {
  const peers = useAwarenessPeers(awareness, localClientId);
  const byUser = new Map<string, PeerUser>();
  for (const peer of peers) {
    const id = peer.user?.id;
    if (id && !byUser.has(id)) byUser.set(id, peer.user!);
  }
  const users = [...byUser.values()];
  if (users.length === 0) return null;

  const shown = users.slice(0, MAX_AVATARS);
  const overflow = users.length - shown.length;

  return (
    <div
      className={cn(
        "flex items-center rounded-full bg-popover/90 p-1 shadow-md backdrop-blur-xl",
        className
      )}
    >
      <div className="flex -space-x-1.5">
        {shown.map((user, index) => (
          <PeerAvatar key={user.id ?? index} user={user} />
        ))}
      </div>
      {overflow > 0 && (
        <span className="ml-1.5 pr-1 text-xs tabular-nums text-muted-foreground">+{overflow}</span>
      )}
    </div>
  );
}

function PeerAvatar({ user }: { user: PeerUser }) {
  const color = user.color ?? "#9ca3af";
  const initial = (user.name?.trim()?.[0] ?? "?").toUpperCase();
  return (
    <div
      className="flex size-7 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-white ring-2"
      style={{ "--tw-ring-color": color } as React.CSSProperties}
      title={user.name ?? "Guest"}
    >
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatarUrl} alt={user.name ?? "Guest"} className="size-full object-cover" />
      ) : (
        initial
      )}
    </div>
  );
}
