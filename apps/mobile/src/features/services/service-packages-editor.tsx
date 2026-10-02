import { serviceFieldStyle } from "./service-field-style";
import { useServiceEditorState, useClearServiceEditorDraft } from "./service-editor-drafts";
import { useState } from "react";
import { Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { SERVICE_TIERS } from "@repo/shared/creator-service";
import { ALL_CURRENCIES } from "@repo/shared/crew";
import { useAuth } from "@/auth";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { appEnv } from "@/config";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import type { CreatorServiceDetail } from "@/data/types";
import { packagesSchema, parsePackageNumber, saveServicePackages } from "./service-packages-api";
type Row = {
  tier: (typeof SERVICE_TIERS)[number];
  enabled: boolean;
  title: string;
  description: string;
  currency: string;
  price: string;
  deliveryDays: string;
  revisions: string;
  scope: string;
};
export function ServicePackagesEditor(props: {
  service: CreatorServiceDetail;
  refresh: () => void;
}) {
  const auth = useAuth();
  if (
    auth.status !== "authenticated" ||
    String(auth.user?.userId ?? auth.user?.id ?? "") !== props.service.creatorId ||
    props.service.status === "archived" ||
    props.service.version === undefined
  )
    return null;
  return (
    <Editor
      key={JSON.stringify([props.service.id, props.service.version, auth.generation])}
      {...props}
    />
  );
}
function Editor({ service, refresh }: { service: CreatorServiceDetail; refresh: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(service.id, useScreenActive());
  const clearDraft = useClearServiceEditorDraft("packages");
  const [draftVersion, setDraftVersion] = useServiceEditorState(
    "packages:version",
    service.version
  );
  const saved = () => {
    clearDraft();
    refresh();
  };
  const discardAndReload = () => {
    clearDraft();
    refresh();
  };
  const initial = (): Row[] =>
    SERVICE_TIERS.map((tier) => {
      const p = service.packages.find((item) => item.tier === tier);
      return {
        tier,
        enabled: !!p,
        title: p?.title ?? "",
        description: p?.description ?? "",
        currency: p?.currency ?? (appEnv.siteRegion === "cn" ? "CNY" : "USD"),
        price: p ? String(p.price) : "",
        deliveryDays: p ? String(p.deliveryDays) : "",
        revisions: p ? String(p.revisions) : "0",
        scope: p?.scope.join("\n") ?? "",
      };
    });
  const [rows, setRows] = useServiceEditorState("packages:rows", initial),
    [open, setOpen] = useServiceEditorState("packages:open", false),
    [error, setError] = useState<string>();
  const parsed = packagesSchema.safeParse({
    expectedVersion: draftVersion,
    packages: rows
      .filter((p) => p.enabled)
      .map((p) => ({
        ...p,
        price: parsePackageNumber(p.price),
        deliveryDays: parsePackageNumber(p.deliveryDays),
        revisions: parsePackageNumber(p.revisions),
        scope: p.scope
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      })),
  });
  const emptyListed = service.status === "listed" && !rows.some((p) => p.enabled);
  const update = (tier: Row["tier"], change: Partial<Row>) =>
    setRows((items) => items.map((item) => (item.tier === tier ? { ...item, ...change } : item)));
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" disabled={op.busy || disabled} onPress={onPress}>
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  if (!open) return button(t("servicePackages.title"), () => setOpen(true));
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{t("servicePackages.title")}</ThemedText>
      <ThemedText>{t("servicePackages.hint")}</ThemedText>
      {rows.map((row) => (
        <View
          key={row.tier}
          style={{ gap: 8, padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement }}
        >
          <ThemedText>{t(`servicePackages.tier.${row.tier}`)}</ThemedText>
          <Switch
            accessibilityLabel={t(`servicePackages.tier.${row.tier}`)}
            value={row.enabled}
            disabled={op.busy}
            onValueChange={(enabled) => update(row.tier, { enabled })}
          />
          {row.enabled && (
            <>
              {(
                [
                  ["title", 80],
                  ["description", 2000],
                  ["price", 20],
                  ["deliveryDays", 3],
                  ["revisions", 4],
                  ["scope", 2411],
                ] as const
              ).map(([field, maxLength]) => (
                <View key={field}>
                  <ThemedText>
                    {t(field === "title" ? "servicePackages.name" : `servicePackages.${field}`)}
                  </ThemedText>
                  <TextInput
                    accessibilityLabel={`${t(`servicePackages.tier.${row.tier}`)} ${t(field === "title" ? "servicePackages.name" : `servicePackages.${field}`)}`}
                    value={row[field]}
                    onChangeText={(value) => update(row.tier, { [field]: value })}
                    maxLength={maxLength}
                    multiline={field === "description" || field === "scope"}
                    editable={!op.busy}
                    style={serviceFieldStyle(theme, field === "description" || field === "scope")}
                  />
                </View>
              ))}
              <ThemedText>{t("servicePackages.currency")}</ThemedText>
              <ScrollView horizontal>
                {(appEnv.siteRegion === "cn" ? ["CNY"] : ALL_CURRENCIES).map((currency) => (
                  <Pressable
                    key={currency}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: row.currency === currency }}
                    disabled={op.busy}
                    onPress={() => update(row.tier, { currency })}
                    style={{
                      padding: 10,
                      backgroundColor:
                        row.currency === currency
                          ? theme.backgroundSelected
                          : theme.backgroundElement,
                    }}
                  >
                    <ThemedText>{currency}</ThemedText>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      ))}
      {(!parsed.success || emptyListed) && (
        <ThemedText>
          {t(emptyListed ? "servicePackages.pauseFirst" : "servicePackages.invalid")}
        </ThemedText>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {button(
        t("profileEdit.save"),
        () => {
          if (!parsed.success || emptyListed) return;
          void op.run(
            () => saveServicePackages(service.id, service.status, parsed.data),
            saved,
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        },
        !parsed.success || emptyListed
      )}
      {button(t("myServices.cancel"), () => {
        setDraftVersion(service.version);
        setRows(initial());
        setError(undefined);
        setOpen(false);
      })}
      {error && button(t("serviceEdit.reload"), discardAndReload)}
    </View>
  );
}
