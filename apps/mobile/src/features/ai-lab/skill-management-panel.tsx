import { pickSkillPackage } from "./skill-package-picker";
import type { SkillPackage } from "./skill-package-content";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ApiRequestError } from "@/lib/api-client";
import type { GenerationProject } from "./projects-api";
import {
  loadSkillCatalog,
  skillMutationBox,
  skillScopes,
  writeSkillMutation,
  type SkillCatalog,
  type SkillMutation,
  type SkillScope,
} from "./skill-management-api";
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 10, opacity: disabled ? 0.45 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
export function SkillManagementPanel({
  userId,
  generation,
  project,
  onBack,
  onBusyChange,
}: {
  userId: string;
  generation: number;
  project: GenerationProject;
  onBack: () => void;
  onBusyChange: (v: boolean) => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation("project-skills", true);
  const [box] = useState(() => skillMutationBox(userId, generation, project));
  const [initial] = useState(() => {
    try {
      return { pending: box.read() ?? null, error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState<SkillMutation | null>(initial.pending),
    [data, setData] = useState<SkillCatalog>(),
    [error, setError] = useState(initial.error),
    [loading, setLoading] = useState(true),
    [epoch, setEpoch] = useState(0),
    [query, setQuery] = useState(""),
    [packageFile, setPackageFile] = useState<SkillPackage>(),
    [importScope, setImportScope] = useState<"project" | "workspace">("project"),
    [importKind, setImportKind] = useState<"general" | "image" | "video">("general"),
    [scope, setScope] = useState<SkillScope>("image_generation"),
    [confirmation, setConfirmation] = useState<
      { intent: SkillMutation; label: string } | "clear"
    >();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    onBusyChange(op.busy);
    return () => onBusyChange(false);
  }, [op.busy, onBusyChange]);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setData(undefined);
    void loadSkillCatalog(project, generation, c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          setData(v);
          setError("");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [project, generation, epoch]);
  function run(intent: SkillMutation) {
    setConfirmation(undefined);
    void op.run(
      () => writeSkillMutation(intent, userId, generation, project, controller.current!.signal),
      () => {
        setPending(null);
        setPackageFile(undefined);
        setError("");
        setEpoch((v) => v + 1);
      },
      (e) => {
        setError(e instanceof Error ? e.message : String(e));
        if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status ?? 0))
          setData(undefined);
        try {
          setPending(box.read() ?? null);
        } catch {
          setData(undefined);
        }
      }
    );
  }
  function prepare(input: Record<string, unknown>, label: string) {
    if (!data?.canManage || pending || op.busy) return;
    setConfirmation({
      intent: {
        ...input,
        clientKey: uuid.v4(),
        ownerKind: project.kind,
        projectId: project.id,
        workspaceId: project.workspaceId,
        expectedProjectRevision: data.projectRevision,
      } as SkillMutation,
      label,
    });
  }
  const locked = op.busy || loading || !!pending || !data?.canManage;
  const defaults = (data?.items ?? []).flatMap((item) =>
    item.installation?.status === "active" &&
    item.installation.defaults.some(
      (d) => d.scope === scope && !d.workbenchMode && !d.sourceSurface
    )
      ? [item.installation.id]
      : []
  );
  const btn = (label: string, action: () => void, disabled = false, key?: string) => (
    <Pressable
      key={key ?? label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={action}
      style={{ padding: 10, opacity: disabled ? 0.45 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
      {btn(t("aiLab.skillsBack"), onBack, op.busy)}
      <ThemedText>
        {t("aiLab.manageSkills")} · {project.title}
      </ThemedText>
      <ThemedText type="small">{t("aiLab.manageSkillsHint")}</ThemedText>
      {btn(
        t("common.retry"),
        () => {
          setConfirmation(undefined);
          setEpoch((v) => v + 1);
        },
        op.busy
      )}
      {loading ? <ActivityIndicator /> : null}
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
      {pending ? (
        <View style={{ gap: 4 }}>
          <ThemedText>{t("aiLab.skillChangePending")}</ThemedText>
          <Button
            label={t("aiLab.skillResume")}
            onPress={() => run(pending)}
            disabled={op.busy || loading || !data?.canManage}
          />
          {btn(t("aiLab.skillClear"), () => setConfirmation("clear"), op.busy)}
        </View>
      ) : null}
      {data && !data.canManage ? <ThemedText>{t("aiLab.skillManageReadOnly")}</ThemedText> : null}
      <View style={{ gap: 6 }}>
        <ThemedText>{t("aiLab.skillImport")}</ThemedText>
        <ThemedText type="small">{t("aiLab.skillImportHint")}</ThemedText>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {(["project", "workspace"] as const).map((value) =>
            btn(
              `${importScope === value ? "✓ " : ""}${t(`aiLab.skillImportScope.${value}`)}`,
              () => setImportScope(value),
              locked || (value === "workspace" && !data?.canManageWorkspace),
              value
            )
          )}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {(["general", "image", "video"] as const).map((value) =>
            btn(
              `${importKind === value ? "✓ " : ""}${t(`aiLab.skillImportKind.${value}`)}`,
              () => setImportKind(value),
              locked,
              value
            )
          )}
        </View>
        <Button
          label={t("aiLab.skillPickPackage")}
          disabled={locked}
          onPress={() => {
            void op.run(
              () => pickSkillPackage(generation, controller.current!.signal),
              (file) => {
                if (file) {
                  setPackageFile(file);
                  setError("");
                }
              },
              (e) => setError(e instanceof Error ? e.message : String(e))
            );
          }}
        />
        {packageFile ? (
          <>
            <ThemedText type="small">
              {packageFile.name} · {packageFile.bytes} B
            </ThemedText>
            {btn(
              t("aiLab.skillImport"),
              () =>
                prepare(
                  { kind: "import", scope: importScope, skillKind: importKind, file: packageFile },
                  `${packageFile.name} · ${t(`aiLab.skillImportScope.${importScope}`)} · ${t(`aiLab.skillImportKind.${importKind}`)}`
                ),
              locked || (importScope === "workspace" && !data?.canManageWorkspace)
            )}
            {btn(
              t("aiLab.skillDiscardPackage"),
              () => setPackageFile(undefined),
              op.busy || !!pending
            )}
          </>
        ) : null}
      </View>
      <TextInput
        accessibilityLabel={t("aiLab.skillSearch")}
        placeholder={t("aiLab.skillSearch")}
        placeholderTextColor={theme.textSecondary}
        value={query}
        onChangeText={setQuery}
        style={{ color: theme.text, padding: 10, backgroundColor: theme.backgroundElement }}
      />
      <ThemedText>{t("aiLab.skillDefaults")}</ThemedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {skillScopes.map((value) =>
          btn(
            `${scope === value ? "✓ " : ""}${t(`aiLab.skillScope.${value}`)}`,
            () => setScope(value),
            op.busy,
            value
          )
        )}
      </View>
      {(data?.items ?? [])
        .filter((item) =>
          `${item.name} ${item.description} ${item.publisherName}`
            .toLowerCase()
            .includes(query.toLowerCase().trim())
        )
        .map((item) => {
          const installed = item.installation,
            version = item.latestVersion;
          const compatible =
            version &&
            (!version.projectKinds.length || version.projectKinds.includes(project.kind));
          return (
            <View
              key={item.id}
              style={{
                padding: 10,
                gap: 4,
                backgroundColor: theme.backgroundElement,
                borderRadius: 8,
              }}
            >
              <ThemedText>
                {item.name} · {installed?.version.version ?? version?.version ?? "—"}
              </ThemedText>
              <ThemedText type="small">{item.description}</ThemedText>
              <ThemedText type="small">{item.publisherName}</ThemedText>
              {!installed ? (
                btn(
                  t("aiLab.skillInstall"),
                  () =>
                    prepare(
                      { kind: "install", skillId: item.id, versionId: version!.id },
                      `${t("aiLab.skillInstall")} · ${item.name}`
                    ),
                  locked || !compatible
                )
              ) : (
                <>
                  {btn(
                    t("aiLab.skillRemove"),
                    () =>
                      prepare(
                        {
                          kind: "remove",
                          installationId: installed.id,
                          expectedRevision: installed.revision,
                        },
                        `${t("aiLab.skillRemove")} · ${item.name}`
                      ),
                    locked
                  )}
                  {installed.status === "active" && installed.version.capabilities.includes(scope)
                    ? btn(
                        `${defaults.includes(installed.id) ? "✓ " : ""}${t("aiLab.skillDefault")} · ${t(`aiLab.skillScope.${scope}`)}`,
                        () =>
                          prepare(
                            {
                              kind: "defaults",
                              scope,
                              installationIds: defaults.includes(installed.id)
                                ? defaults.filter((id) => id !== installed.id)
                                : [...defaults, installed.id],
                            },
                            `${item.name} · ${t(`aiLab.skillScope.${scope}`)}`
                          ),
                        locked
                      )
                    : null}
                </>
              )}
            </View>
          );
        })}
      {data && !data.items.length ? <ThemedText>{t("aiLab.noSkills")}</ThemedText> : null}
      {confirmation ? (
        <View style={{ padding: 12, gap: 6, backgroundColor: theme.backgroundElement }}>
          <ThemedText>
            {confirmation === "clear"
              ? t("aiLab.skillClearHint")
              : `${t("aiLab.skillConfirm")} ${confirmation.label}`}
          </ThemedText>
          {btn(t("common.cancel"), () => setConfirmation(undefined), op.busy)}
          <Button
            label={t("aiLab.confirm")}
            onPress={() => {
              if (confirmation === "clear") {
                try {
                  if (pending) box.clear(pending.clientKey);
                  setPending(null);
                  setConfirmation(undefined);
                  setEpoch((v) => v + 1);
                } catch (e) {
                  setError(String(e));
                }
              } else run(confirmation.intent);
            }}
            disabled={op.busy}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}
