"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconBell, IconLoader2, IconMessage } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { V1MessageItem } from "@/src/types/workspace";

// ─── Constants ──────────────────────────────────────────

type MessageCategory = "INTERACTION" | "SYSTEM";

const HANDLE_STATUS = {
  APPROVED: "APPROVED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
} as const;

const PAGE_SIZE = 20;

// ─── Smart Time ─────────────────────────────────────────

function useSmartTime() {
  const t = useTranslations("project");
  return (timestring?: string | null) => {
    if (!timestring) return "";
    const d = new Date(timestring).getTime();
    if (Number.isNaN(d)) return String(timestring);
    const diff = (Date.now() - d) / 1000;
    if (diff < 30) return t("justNow");
    if (diff < 3600) return t("minutesAgo", { count: Math.ceil(diff / 60) });
    if (diff < 86400) return t("hoursAgo", { count: Math.ceil(diff / 3600) });
    if (diff < 172800) return t("oneDayAgo");
    const date = new Date(timestring);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };
}

// ─── Message Card ───────────────────────────────────────

function MessageCard({
  message,
  onRead,
  onApprove,
}: {
  message: V1MessageItem;
  onRead: () => void;
  onApprove?: (approve: boolean) => void;
}) {
  const t = useTranslations("project");
  const formatTime = useSmartTime();
  const unread = message.status === "UNREAD";
  const isApprovalType = message.type === "MEMBER_APPROVE" || message.type === "ACCEPT_INVITE";

  const handleStatusLabel = (() => {
    switch (message.handleStatus) {
      case HANDLE_STATUS.APPROVED:
        return t("approved");
      case HANDLE_STATUS.ACCEPTED:
        return t("accepted");
      case HANDLE_STATUS.REJECTED:
        return t("rejected");
      default:
        return null;
    }
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !isApprovalType && onRead()}
      onKeyDown={(e) => {
        if (e.key === "Enter") !isApprovalType && onRead();
      }}
      className={cn(
        "flex gap-3 rounded-lg px-3 py-2.5 transition-all",
        unread ? "cursor-pointer hover:bg-muted/50" : "opacity-60",
        !isApprovalType && unread && "cursor-pointer"
      )}
    >
      {/* Icon */}
      <div className="relative mt-0.5 shrink-0">
        <div className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <IconMessage className="size-4" />
        </div>
        {unread && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary" />}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-[13px] font-medium">
          {message.title || message.type || t("notification")}
        </div>
        <div className="text-xs leading-relaxed text-muted-foreground">{message.content}</div>

        {/* Action buttons for approval types */}
        {isApprovalType && unread && !handleStatusLabel && (
          <div className="flex gap-2 pt-1">
            <Button
              size="xs"
              variant="outline"
              color="muted"
              onClick={(e) => {
                e.stopPropagation();
                onApprove?.(false);
              }}
            >
              {t("reject")}
            </Button>
            <Button
              size="xs"
              variant="solid"
              color="success"
              onClick={(e) => {
                e.stopPropagation();
                onApprove?.(true);
              }}
            >
              {message.type === "ACCEPT_INVITE" ? t("accept") : t("approve")}
            </Button>
          </div>
        )}

        {/* Handle status for processed messages */}
        {isApprovalType && handleStatusLabel && (
          <div className="inline-flex items-center rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
            {handleStatusLabel}
          </div>
        )}

        <div className="text-[10px] text-muted-foreground/50">{formatTime(message.createTime)}</div>
      </div>
    </div>
  );
}

// ─── Popover ────────────────────────────────────────────

interface ProjectMessagesPopoverProps {
  unreadCount: number;
  onUnreadCountChange?: () => void;
}

export function ProjectMessagesPopover({
  unreadCount,
  onUnreadCountChange,
}: ProjectMessagesPopoverProps) {
  const t = useTranslations("project");

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MessageCategory>("INTERACTION");
  const [interactionMessages, setInteractionMessages] = useState<V1MessageItem[]>([]);
  const [systemMessages, setSystemMessages] = useState<V1MessageItem[]>([]);
  const [interactionTotal, setInteractionTotal] = useState(0);
  const [systemTotal, setSystemTotal] = useState(0);
  const [interactionHasMore, setInteractionHasMore] = useState(true);
  const [systemHasMore, setSystemHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const interactionPageRef = useRef(1);
  const systemPageRef = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(
    async (category: MessageCategory, page: number) => {
      setLoading(true);
      try {
        const data = await backendApi.post<Paginated<V1MessageItem>>(
          "/api/user/message/queryPage",
          { data: { page, pageSize: PAGE_SIZE, receive: true, category } }
        );
        const list = data?.list ?? [];
        const total = Number(data?.totalCount ?? 0);
        const hasMore = list.length === PAGE_SIZE;

        if (category === "INTERACTION") {
          setInteractionMessages((prev) => (page === 1 ? list : [...prev, ...list]));
          setInteractionTotal(total);
          setInteractionHasMore(hasMore);
        } else {
          setSystemMessages((prev) => (page === 1 ? list : [...prev, ...list]));
          setSystemTotal(total);
          setSystemHasMore(hasMore);
        }
      } catch (error) {
        console.error("[MessagesPopover] load failed:", error);
        toast.error(t("loadMessagesFailed"));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    if (!open) return;
    interactionPageRef.current = 1;
    systemPageRef.current = 1;
    void loadMessages("INTERACTION", 1);
    void loadMessages("SYSTEM", 1);
  }, [open, loadMessages]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el || loading) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      if (activeTab === "INTERACTION" && interactionHasMore) {
        interactionPageRef.current += 1;
        void loadMessages("INTERACTION", interactionPageRef.current);
      } else if (activeTab === "SYSTEM" && systemHasMore) {
        systemPageRef.current += 1;
        void loadMessages("SYSTEM", systemPageRef.current);
      }
    }
  };

  const handleRead = async (message: V1MessageItem, handleStatus?: string) => {
    if (message.status !== "UNREAD") return;
    const id = String(message.id ?? "");
    if (!id) return;

    try {
      const url = handleStatus
        ? `/api/user/message/read/${id}/${handleStatus}`
        : `/api/user/message/read/${id}`;
      await backendApi.post(url);

      const updater = (prev: V1MessageItem[]) =>
        prev.map((m) =>
          String(m.id) === id
            ? { ...m, status: "READ", handleStatus: handleStatus || m.handleStatus }
            : m
        );
      setInteractionMessages(updater);
      setSystemMessages(updater);
      onUnreadCountChange?.();
    } catch (error) {
      console.error("[MessagesPopover] read failed:", error);
      toast.error(t("markReadFailed"));
    }
  };

  const handleApprove = async (message: V1MessageItem, approve: boolean) => {
    try {
      const params = JSON.parse(message.operationParams || "{}");

      if (message.type === "MEMBER_APPROVE" && params.id) {
        await backendApi.post(`/api/user/projectMember/approveInvite/${params.id}/${approve}`);
      } else if (message.type === "ACCEPT_INVITE" && params.projectId) {
        await backendApi.post(
          `/api/user/projectMember/acceptInvite/${params.projectId}/${approve}`
        );
      }

      const status = (() => {
        if (!approve) return HANDLE_STATUS.REJECTED;
        if (message.type === "ACCEPT_INVITE") return HANDLE_STATUS.ACCEPTED;
        return HANDLE_STATUS.APPROVED;
      })();

      await handleRead(message, status);
    } catch (error) {
      console.error("[MessagesPopover] approve failed:", error);
      toast.error(message.type === "ACCEPT_INVITE" ? t("acceptFailed") : t("approveFailed"));
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await backendApi.post("/api/user/message/readAll");
      const markAll = (prev: V1MessageItem[]) => prev.map((m) => ({ ...m, status: "READ" }));
      setInteractionMessages(markAll);
      setSystemMessages(markAll);
      onUnreadCountChange?.();
    } catch (error) {
      console.error("[MessagesPopover] mark all failed:", error);
      toast.error(t("markAllReadFailed"));
    }
  };

  const messages = activeTab === "INTERACTION" ? interactionMessages : systemMessages;
  const hasMore = activeTab === "INTERACTION" ? interactionHasMore : systemHasMore;
  const emptyText =
    activeTab === "INTERACTION" ? t("noInteractionMessages") : t("noSystemMessages");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex size-9 items-center justify-center rounded-xl border border-border bg-background/60 transition-colors hover:bg-muted/20"
        >
          <IconBell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="flex w-[400px] flex-col p-0"
        style={{ maxHeight: "min(600px, 80vh)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <h3 className="text-sm font-semibold">{t("messages")}</h3>
          <Button size="xs" variant="ghost" color="muted" onClick={() => void handleMarkAllRead()}>
            {t("markAllRead")}
          </Button>
        </div>

        {/* Tabs */}
        <div className="px-4 pb-3">
          <ToggleGroup
            type="single"
            value={activeTab}
            onValueChange={(v) => v && setActiveTab(v as MessageCategory)}
            className="w-full rounded-lg bg-muted/50 p-0.5"
          >
            <ToggleGroupItem
              value="INTERACTION"
              className="flex-1 rounded-md bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-transparent data-[state=on]:!bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              {t("interaction")}({interactionTotal})
            </ToggleGroupItem>
            <ToggleGroupItem
              value="SYSTEM"
              className="flex-1 rounded-md bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-transparent data-[state=on]:!bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              {t("system")}({systemTotal})
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Message list */}
        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-auto px-1 pb-2"
          onScroll={handleScroll}
        >
          {loading && messages.length === 0 ? (
            <div className="flex h-48 items-center justify-center">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
              <IconBell className="size-8 text-muted-foreground/20" />
              <p className="text-xs text-muted-foreground">{emptyText}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {messages.map((msg) => (
                <MessageCard
                  key={String(msg.id)}
                  message={msg}
                  onRead={() => void handleRead(msg)}
                  onApprove={(approve) => void handleApprove(msg, approve)}
                />
              ))}
              {!hasMore && messages.length > 0 && (
                <p className="py-3 text-center text-[10px] text-muted-foreground/40">
                  {t("noMore")}
                </p>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
