import { AssetFileUpload } from "@/features/crew-assets/file-upload";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { CrewAssetPicker } from "@/features/crew-assets/asset-picker";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { TaskContract } from "./task-contract";
export function TaskContractField({
  crewId,
  userId,
  generation,
  value,
  onChange,
  locked,
}: {
  crewId: string;
  userId: string;
  generation: number;
  value: string | null;
  onChange: (id: string | null) => void;
  locked: boolean;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [open, setOpen] = useState(false);
  const [upload, setUpload] = useState(false);
  const current = () => !locked && generation === getAuthGeneration();
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        disabled={locked}
        style={{ padding: 12 }}
        onPress={() => {
          if (current()) setOpen(true);
        }}
      >
        <ThemedText>{t("taskContract.choose")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={locked}
        style={{ padding: 12 }}
        onPress={() => {
          if (current()) setUpload(true);
        }}
      >
        <ThemedText>{t("thread.uploadFile")}</ThemedText>
      </Pressable>
      {upload && !locked && (
        <ContractUpload
          crewId={crewId}
          userId={userId}
          generation={generation}
          onClose={() => setUpload(false)}
          onChange={onChange}
        />
      )}
      {value && (
        <>
          <TaskContract crewId={crewId} userId={userId} generation={generation} assetId={value} />
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            style={{ padding: 12 }}
            onPress={() => {
              if (current()) onChange(null);
            }}
          >
            <ThemedText>{t("taskContract.remove")}</ThemedText>
          </Pressable>
        </>
      )}
      <Modal visible={open && !locked} animationType="slide" onRequestClose={() => setOpen(false)}>
        {open && !locked && (
          <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            <CrewAssetPicker
              crewId={crewId}
              remaining={1}
              excludedIds={value ? [value] : []}
              onClose={() => setOpen(false)}
              onSelect={(assets) => {
                if (!current() || assets.length !== 1) return;
                const asset = assets[0]!;
                if (asset.kind !== "file" || asset.status !== "active" || !asset.media) return;
                onChange(asset.id);
                setOpen(false);
              }}
            />
          </SafeAreaView>
        )}
      </Modal>
    </View>
  );
}

function ContractUpload({
  crewId,
  userId,
  generation,
  onClose,
  onChange,
}: {
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
  onChange: (id: string) => void;
}) {
  const theme = useTheme(),
    t = useTranslations();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const current = () => live.current && generation === getAuthGeneration();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <AssetFileUpload
          crewId={crewId}
          userId={userId}
          generation={generation}
          parentId={null}
          destination={t("studioMedia.root")}
          onClose={() => {
            if (current()) onClose();
          }}
          onAttached={(asset) => {
            if (current() && asset.kind === "file" && asset.status === "active" && asset.media)
              onChange(asset.id);
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}
