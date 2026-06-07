"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconLoader2,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconUpload,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { backendApi } from "@/src/lib/api";
import type { VoiceOptionItem } from "@/src/types/workspace";
import { buildOssUrl, uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";

const AUDIO_MAX_SIZE = 20 * 1024 * 1024;

// Language options for the custom-voice form. The `lang` value Java stores on
// VoiceInfo IS the language display label itself (voices/list groups by
// voiceInfo.getLang() directly), so these are the exact label strings the
// backend expects — NOT codes like "zh"/"en". They render as-is (a language in
// its own script is the clearest label).
const CUSTOM_VOICE_LANGS = ["简体中文", "English", "粵語", "한국어", "日本語"] as const;

export function VoicePickerDialog({
  open,
  onOpenChange,
  voices,
  loading,
  selectedVoiceId,
  onSelect,
  canAddCustomVoice = false,
  onVoiceAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voices: Record<string, VoiceOptionItem[]>;
  loading: boolean;
  selectedVoiceId: string;
  onSelect: (voice: VoiceOptionItem) => void;
  /** Whether to surface the "Add custom voice" entry. Custom voices only
   *  surface under `voiceType=all`, so this is gated to "All" mode. */
  canAddCustomVoice?: boolean;
  /** Re-fetches the voice list after a custom voice is registered, so the
   *  new voice appears immediately. Resolves to the refreshed grouped map. */
  onVoiceAdded?: () => Promise<Record<string, VoiceOptionItem[]>>;
}) {
  const t = useTranslations("character");
  const tc = useTranslations("common");
  const [activeLang, setActiveLang] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tabs = useMemo(() => Object.entries(voices), [voices]);
  const currentLang = activeLang || tabs[0]?.[0] || "";

  // ─── Custom voice upload form ──────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addName, setAddName] = useState("");
  const [addLang, setAddLang] = useState<string>(CUSTOM_VOICE_LANGS[0]);
  const [addDescription, setAddDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resetAddForm = useCallback(() => {
    setShowAddForm(false);
    setAddFile(null);
    setAddName("");
    setAddLang(CUSTOM_VOICE_LANGS[0]);
    setAddDescription("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // Close + reset the add form whenever the dialog closes.
  useEffect(() => {
    if (!open) resetAddForm();
  }, [open, resetAddForm]);

  const handlePickFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      if (file.size > AUDIO_MAX_SIZE) {
        toast.error(tc("fileSizeExceedMb", { size: AUDIO_MAX_SIZE / (1024 * 1024) }));
        return;
      }
      setAddFile(file);
    },
    [tc]
  );

  const handleSubmitCustomVoice = useCallback(async () => {
    if (submitting) return;
    const name = addName.trim();
    if (!addFile || !name || !addLang) {
      toast.error(t("customVoiceMissingFields"));
      return;
    }
    setSubmitting(true);
    try {
      const uploaded = await uploadWorkspaceFile(addFile, {
        uploadType: "SHOT_VALUE_AUDIO",
        sourceType: "LOCAL",
        accept: "audio/*",
        maxSize: AUDIO_MAX_SIZE,
      });
      // voices/add CREATES the voice and returns it carrying its new id; the
      // character binds that id (same as picking an existing voice). Bind by the
      // returned id — names aren't unique, so don't match on voiceName.
      const created = (await backendApi.post<VoiceOptionItem>("/api/ai/voice/voices/add", {
        data: {
          lang: addLang,
          voiceName: name,
          voiceDescription: addDescription.trim(),
          remark: "",
          voicePath: uploaded.path,
        },
      })) as VoiceOptionItem | undefined;
      const newVoiceId = String(created?.voiceId ?? created?.id ?? "");
      toast.success(t("customVoiceAdded"));
      // Refresh so the new voice surfaces in the list (under voiceType=all).
      const refreshed = (await onVoiceAdded?.()) ?? {};
      const flat = Object.values(refreshed).flat();
      const added =
        (newVoiceId
          ? flat.find((v) => String(v.voiceId ?? v.id ?? "") === newVoiceId)
          : undefined) ?? flat.find((v) => String(v.voiceName ?? "") === name);
      resetAddForm();
      setActiveLang(addLang);
      if (added) {
        onSelect(added);
        onOpenChange(false);
      } else if (newVoiceId) {
        // The refreshed list hasn't caught up — still bind the returned id.
        onSelect({
          voiceId: newVoiceId,
          voiceName: name,
          voicePath: uploaded.path,
        } as VoiceOptionItem);
        onOpenChange(false);
      }
    } catch (error) {
      console.error("[VoicePickerDialog] 自定义音色上传失败:", error);
      toast.error(tc("uploadFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [
    addDescription,
    addFile,
    addLang,
    addName,
    onOpenChange,
    onSelect,
    onVoiceAdded,
    resetAddForm,
    submitting,
    t,
    tc,
  ]);

  useEffect(() => {
    if (!open) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    }
  }, [open]);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingVoiceId("");
  }, []);

  useEffect(() => stopAudio, [stopAudio]);

  const togglePlay = useCallback(
    (voice: VoiceOptionItem) => {
      const voiceId = String(voice.voiceId ?? "");
      if (!voice.voicePath) return;
      if (playingVoiceId === voiceId) {
        stopAudio();
        return;
      }
      stopAudio();
      const audio = new Audio(buildOssUrl(String(voice.voicePath)));
      audio.onended = () => setPlayingVoiceId("");
      audio.onerror = () => setPlayingVoiceId("");
      audioRef.current = audio;
      setPlayingVoiceId(voiceId);
      void audio.play().catch((error) => {
        console.error("[VoicePickerDialog] 播放失败:", error);
        setPlayingVoiceId("");
      });
    },
    [playingVoiceId, stopAudio]
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[80vh] flex-col overflow-hidden p-0 sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{t("voicePickerTitle")}</DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            {canAddCustomVoice ? (
              <div className="mb-4 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  color="muted"
                  size="sm"
                  onClick={() => setShowAddForm(true)}
                  className="gap-1.5"
                >
                  <IconPlus className="size-3.5" />
                  {t("addCustomVoice")}
                </Button>
              </div>
            ) : null}

            {tabs.length > 1 ? (
              <div className="mb-4 shrink-0 flex flex-wrap gap-2">
                {tabs.map(([lang, items]) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setActiveLang(lang)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs transition-colors",
                      currentLang === lang
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {lang} ({items.length})
                  </button>
                ))}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex h-40 items-center justify-center">
                  <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-2">
                  {(voices[currentLang] ?? tabs[0]?.[1] ?? []).map((voice) => {
                    const voiceId = String(voice.voiceId ?? "");
                    const active = voiceId === selectedVoiceId;
                    return (
                      <button
                        key={voiceId}
                        type="button"
                        onClick={() => {
                          onSelect(voice);
                          onOpenChange(false);
                          stopAudio();
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors",
                          active
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-white/20 hover:bg-white/[0.02]"
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-foreground">
                            {voice.voiceName || voiceId}
                          </div>
                          {voice.voiceDescription ? (
                            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {voice.voiceDescription}
                            </div>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          color="muted"
                          size="icon-sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePlay(voice);
                          }}
                        >
                          {playingVoiceId === voiceId ? (
                            <IconPlayerStop className="size-4" />
                          ) : (
                            <IconPlayerPlay className="size-4" />
                          )}
                        </Button>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showAddForm}
        onOpenChange={(next) => {
          if (!next && !submitting) resetAddForm();
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t("addCustomVoice")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(event) => handlePickFile(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border border-dashed border-border bg-background px-3 py-2 text-left text-sm transition-colors",
                "hover:border-primary/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
                addFile ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <IconUpload className="size-4 shrink-0 opacity-60" />
              <span className="truncate">{addFile ? addFile.name : t("customVoiceFile")}</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <Input
                value={addName}
                onChange={(event) => setAddName(event.target.value)}
                placeholder={t("customVoiceName")}
                maxLength={30}
                disabled={submitting}
              />
              <Select value={addLang} onValueChange={setAddLang} disabled={submitting}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("customVoiceLanguage")} />
                </SelectTrigger>
                <SelectContent position="popper">
                  {CUSTOM_VOICE_LANGS.map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {lang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Textarea
              value={addDescription}
              onChange={(event) => setAddDescription(event.target.value)}
              placeholder={t("customVoiceDescription")}
              rows={3}
              maxLength={120}
              disabled={submitting}
              showCount
              className="resize-none"
            />
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              color="muted"
              size="sm"
              onClick={resetAddForm}
              disabled={submitting}
            >
              {tc("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSubmitCustomVoice()}
              disabled={submitting || !addFile || !addName.trim()}
            >
              {submitting ? <IconLoader2 className="mr-1 size-4 animate-spin" /> : null}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
