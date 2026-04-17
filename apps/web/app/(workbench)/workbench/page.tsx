"use client";

import { useMemo, useState } from "react";
import {
  IconLayoutDashboard,
  IconInbox,
  IconCircleFilled,
  IconChevronRight,
  IconArrowLeft,
  IconCheck,
  IconChecks,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  MOCK_MESSAGES,
  MESSAGE_TYPE_CONFIG,
  MESSAGE_FILTERS,
  type WorkbenchMessage,
} from "@/components/workbench/workbench-mock";

export default function WorkbenchPage() {
  const t = useTranslations("workbench");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState(MOCK_MESSAGES);

  const unreadCount = useMemo(() => messages.filter((m) => !m.read).length, [messages]);

  const filteredMessages = useMemo(() => {
    if (filter === "all") return messages;
    if (filter === "unread") return messages.filter((m) => !m.read);
    return messages.filter((m) => m.type === filter);
  }, [messages, filter]);

  const selectedMessage = useMemo(
    () => (selectedId ? (messages.find((m) => m.id === selectedId) ?? null) : null),
    [selectedId, messages]
  );

  const markAsRead = (id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, read: true } : m)));
  };

  const markAllAsRead = () => {
    setMessages((prev) => prev.map((m) => ({ ...m, read: true })));
  };

  const selectMessage = (msg: WorkbenchMessage) => {
    setSelectedId(msg.id);
    if (!msg.read) markAsRead(msg.id);
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <IconLayoutDashboard className="size-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">{t("title")}</h1>
          {unreadCount > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllAsRead}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <IconChecks className="size-3.5" /> {t("markAllRead")}
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left: filter + message list */}
        <div
          className={cn(
            "flex flex-col border-r border-border",
            selectedMessage ? "w-96 shrink-0" : "flex-1 max-w-2xl"
          )}
        >
          {/* Filters */}
          <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3">
            {MESSAGE_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === f.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                {t(f.labelKey)}
                {f.value === "unread" && unreadCount > 0 && (
                  <span className="ml-1 rounded-full bg-primary/20 px-1.5 text-[10px]">
                    {unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Message list */}
          <div className="flex-1 overflow-y-auto">
            {filteredMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <IconInbox className="mb-3 size-10 opacity-30" />
                <p className="text-sm">{t("noMessages")}</p>
              </div>
            ) : (
              filteredMessages.map((msg) => {
                const typeConf = MESSAGE_TYPE_CONFIG[msg.type];
                const isSelected = selectedId === msg.id;
                return (
                  <button
                    key={msg.id}
                    type="button"
                    onClick={() => selectMessage(msg)}
                    className={cn(
                      "flex w-full items-start gap-3 border-b border-border px-4 py-3.5 text-left transition-colors",
                      isSelected ? "bg-primary/5" : "hover:bg-secondary/50",
                      !msg.read && "bg-primary/[0.02]"
                    )}
                  >
                    {/* Unread dot */}
                    <div className="mt-1.5 w-2 shrink-0">
                      {!msg.read && <IconCircleFilled className="size-2 text-primary" />}
                    </div>

                    {/* Icon */}
                    <div
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-sm",
                        typeConf.color
                      )}
                    >
                      {typeConf.icon}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            msg.read ? "text-foreground" : "font-semibold text-foreground"
                          )}
                        >
                          {msg.title}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {msg.time}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{msg.sender}</div>
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/70">
                        {msg.summary}
                      </p>
                      {msg.crewName && (
                        <span className="mt-1.5 inline-block rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {msg.crewName}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: message detail */}
        {selectedMessage ? (
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Detail header */}
            <div className="flex items-start justify-between border-b border-border px-6 py-4">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="mb-2 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground xl:hidden"
                >
                  <IconArrowLeft className="size-3" /> {t("backToList")}
                </button>
                <h2 className="text-lg font-bold text-foreground">{selectedMessage.title}</h2>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{selectedMessage.sender}</span>
                  <span>·</span>
                  <span>{selectedMessage.time}</span>
                  {selectedMessage.crewName && (
                    <>
                      <span>·</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5">
                        {selectedMessage.crewName}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full text-lg",
                  MESSAGE_TYPE_CONFIG[selectedMessage.type].color
                )}
              >
                {MESSAGE_TYPE_CONFIG[selectedMessage.type].icon}
              </div>
            </div>

            {/* Detail body */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="prose prose-sm prose-invert max-w-none">
                {selectedMessage.body.split("\n").map((line, i) => {
                  if (line.startsWith("**") && line.endsWith("**")) {
                    return (
                      <h3 key={i} className="text-sm font-bold text-foreground">
                        {line.slice(2, -2)}
                      </h3>
                    );
                  }
                  if (line.startsWith("- ")) {
                    return (
                      <div
                        key={i}
                        className="flex items-start gap-2 py-0.5 text-sm text-foreground/80"
                      >
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/30" />
                        {line.slice(2)}
                      </div>
                    );
                  }
                  if (!line.trim()) return <div key={i} className="h-3" />;
                  return (
                    <p key={i} className="text-sm leading-relaxed text-foreground/80">
                      {line}
                    </p>
                  );
                })}
              </div>

              {/* Action */}
              {selectedMessage.actionUrl && selectedMessage.actionLabelKey && (
                <div className="mt-8">
                  <a
                    href={selectedMessage.actionUrl}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    {t(selectedMessage.actionLabelKey)} <IconChevronRight className="size-4" />
                  </a>
                </div>
              )}

              {/* Crew invite actions */}
              {selectedMessage.type === "crew_invite" && (
                <div className="mt-8 flex items-center gap-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg bg-green-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-500/90"
                  >
                    <IconCheck className="size-4" /> {t("acceptInvite")}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/70"
                  >
                    {t("declineInvite")}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="hidden flex-1 items-center justify-center xl:flex">
            <div className="text-center text-muted-foreground">
              <IconInbox className="mx-auto mb-3 size-12 opacity-20" />
              <p className="text-sm">{t("selectMessage")}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
