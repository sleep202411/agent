import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { fetchCrewSkills } from "./crew-skills-api";

export function CrewSkillsField({
  value,
  onChange,
  generation,
  locked,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  generation: number;
  locked: boolean;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ skills?: string[]; error?: string }>({});
  const current = () => !locked && generation === getAuthGeneration();
  useEffect(() => {
    if (!open || locked) return;
    const controller = new AbortController();
    void fetchCrewSkills(controller.signal).then(
      (skills) => {
        if (!controller.signal.aborted && generation === getAuthGeneration()) setState({ skills });
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setState({ error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [open, locked, generation, attempt]);
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("crewSkills.label")}
        accessibilityState={{ expanded: open, disabled: locked }}
        disabled={locked}
        style={{ padding: 12 }}
        onPress={() => {
          if (current()) {
            setState({});
            setOpen(!open);
          }
        }}
      >
        <ThemedText>
          {t("crewSkills.label")} · {value.length}/20
        </ThemedText>
        {!!value.length && <ThemedText>{value.join(", ")}</ThemedText>}
      </Pressable>
      {open && (
        <>
          {!state.skills && !state.error && (
            <ActivityIndicator accessibilityLabel={t("crewSkills.loading")} />
          )}
          {state.error && (
            <>
              <ThemedText accessibilityRole="alert">{state.error}</ThemedText>
              <Pressable
                accessibilityRole="button"
                disabled={locked}
                onPress={() => {
                  if (current()) {
                    setState({});
                    setAttempt((n) => n + 1);
                  }
                }}
              >
                <ThemedText>{t("crewSkills.retry")}</ThemedText>
              </Pressable>
            </>
          )}
          <ScrollView
            nestedScrollEnabled
            style={{ maxHeight: 200 }}
            contentContainerStyle={{ gap: 4 }}
          >
            {[...new Set([...(state.skills ?? []), ...value])].map((skill) => {
              const selected = value.includes(skill);
              const disabled = locked || (!selected && (value.length >= 20 || !state.skills));
              return (
                <Pressable
                  key={skill}
                  accessibilityRole="checkbox"
                  accessibilityLabel={skill}
                  accessibilityState={{ checked: selected, disabled }}
                  disabled={disabled}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
                  }}
                  onPress={() => {
                    if (current() && !disabled)
                      onChange(
                        selected ? value.filter((item) => item !== skill) : [...value, skill]
                      );
                  }}
                >
                  <ThemedText>
                    {selected ? "✓ " : ""}
                    {skill}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      )}
    </View>
  );
}
