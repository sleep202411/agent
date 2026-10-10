import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import {
  fetchOrganizationNode,
  type OrganizationNode,
} from "@/features/crew-assets/organization-api";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { ConversationFile } from "./conversation-file";
type Props = { crewId: string; userId: string; generation: number; assetId: string };
export function TaskContract(props: Props) {
  const active = useScreenActive();
  return active && props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.assetId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [requested, setRequested] = useState(false),
    [revision, setRevision] = useState(0);
  const [node, setNode] = useState<OrganizationNode>(),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!requested) return;
    const c = new AbortController();
    void fetchOrganizationNode(
      props.crewId,
      props.userId,
      props.generation,
      props.assetId,
      c.signal
    )
      .then((value) => {
        if (c.signal.aborted || getAuthGeneration() !== props.generation) return;
        if (value.kind !== "file" || value.status !== "active" || !value.media)
          throw new Error(t("taskContract.unavailable"));
        setNode(value);
      })
      .catch((cause) => {
        if (!c.signal.aborted && getAuthGeneration() === props.generation)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!c.signal.aborted && getAuthGeneration() === props.generation) setBusy(false);
      });
    return () => c.abort();
  }, [requested, revision, props.crewId, props.userId, props.generation, props.assetId, t]);
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        style={{ paddingVertical: 12 }}
        onPress={() => {
          setBusy(true);
          setNode(undefined);
          setError("");
          setRequested(true);
          setRevision((v) => v + 1);
        }}
      >
        <ThemedText>{t(node ? "taskContract.refresh" : "taskContract.open")}</ThemedText>
      </Pressable>
      {busy && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {node?.media && !busy && <ConversationFile mediaAssetId={node.media.id} name={node.name} />}
    </View>
  );
}
