import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { toHref } from "@/lib/navigation";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { CrewCreation } from "./crew-creation";
import { TaskWorkbench } from "./task-workbench";
import { PositionCreate } from "./position-create";
const crew = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), name: z.string() });
type Props = { userId: string; generation: number; mode: "task" | "position"; onClose: () => void };
export function CrewWorkEntry(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.userId}:${props.generation}:${props.mode}`} {...props} />
  ) : null;
}
function Session({ userId, generation, mode, onClose }: Props) {
  const t = useTranslations(),
    router = useRouter(),
    active = useScreenActive();
  const [step, setStep] = useState<"choose" | "new" | "work">("choose"),
    [selected, setSelected] = useState("");
  const [revision, setRevision] = useState(0),
    [result, setResult] = useState<{
      key: string;
      items?: z.infer<typeof crew>[];
      allowed?: boolean;
      error?: string;
    }>();
  const key = JSON.stringify([active, revision, selected, mode]);
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setResult(undefined);
  }
  useEffect(() => {
    if (!active || step !== "choose") return;
    const c = new AbortController();
    void (async () => {
      const page = z.object({ founded: z.array(crew), joined: z.array(crew) }).parse(
        await api.get("/crews/my", {
          service: "aurora",
          signal: c.signal,
          retry: false,
          cache: "no-store",
        })
      );
      const items = [
        ...new Map([...page.founded, ...page.joined].map((item) => [item.id, item])).values(),
      ];
      let allowed = false;
      if (selected && items.some((item) => item.id === selected)) {
        const member = z.object({ userId: z.string(), permissions: z.array(z.string()) }).parse(
          await api.get(`/crews/${encodeURIComponent(selected)}/members/me`, {
            service: "aurora",
            signal: c.signal,
            retry: false,
            cache: "no-store",
          })
        );
        if (member.userId !== userId) throw Error("Crew membership account mismatch.");
        allowed = member.permissions.includes(mode === "task" ? "tasks.view" : "openings.manage");
      }
      if (!c.signal.aborted && generation === getAuthGeneration())
        setResult({ key, items, allowed });
    })().catch((cause) => {
      if (!c.signal.aborted && generation === getAuthGeneration())
        setResult({ key, error: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => c.abort();
  }, [active, step, selected, generation, userId, mode, revision, key]);
  const current = active && result?.key === key ? result : undefined;
  const back = () => {
    setStep("choose");
    setRevision((v) => v + 1);
  };
  if (step === "new")
    return (
      <CrewCreation
        userId={userId}
        generation={generation}
        onClose={back}
        onCertification={() => router.push(toHref("/certification-application?level=13"))}
        onCreated={(id) => {
          setSelected(id);
          setStep("work");
        }}
      />
    );
  if (step === "work")
    return mode === "position" ? (
      <PositionCreate
        crewId={selected}
        userId={userId}
        generation={generation}
        active={active}
        onClose={back}
      />
    ) : (
      <TaskWorkbench
        crewId={selected}
        userId={userId}
        generation={generation}
        onClose={back}
        onCreated={(id) => router.replace(toHref(`/crew-tasks/${selected}?task=${id}`))}
      />
    );
  return (
    <ScrollView
      style={{ display: active ? "flex" : "none" }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>
        {t(mode === "position" ? "taskEntry.positionDescription" : "taskEntry.description")}
      </ThemedText>
      {!current && <ActivityIndicator />}
      {!!current?.error && (
        <>
          <ThemedText accessibilityRole="alert">{current.error}</ThemedText>
          <Button label={t("taskEntry.retry")} onPress={() => setRevision((v) => v + 1)} />
        </>
      )}
      {current?.items?.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected === item.id }}
          onPress={() => setSelected(item.id)}
          style={{ padding: 12 }}
        >
          <ThemedText>
            {selected === item.id ? "● " : "○ "}
            {item.name}
          </ThemedText>
        </Pressable>
      ))}
      {current?.items?.length === 0 && <ThemedText>{t("taskEntry.empty")}</ThemedText>}
      {!!selected && current?.items && !current.allowed && (
        <ThemedText>
          {t(mode === "position" ? "taskEntry.cannotManagePositions" : "taskEntry.cannotManage")}
        </ThemedText>
      )}
      {current?.allowed && (
        <Button
          label={t(mode === "position" ? "taskEntry.continuePosition" : "taskEntry.continue")}
          onPress={() => setStep("work")}
        />
      )}
      <Button label={t("taskEntry.newCrew")} onPress={() => setStep("new")} />
      <Button label={t("common.cancel")} onPress={onClose} />
    </ScrollView>
  );
}
function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <View>
      <Pressable accessibilityRole="button" onPress={onPress} style={{ padding: 12 }}>
        <ThemedText>{label}</ThemedText>
      </Pressable>
    </View>
  );
}
