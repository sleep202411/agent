import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { ThemedText } from "@/components/themed-text";
import { SectionHeader } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations } from "@/i18n";
import {
  listCreatorCertificates,
  publicCertificateImage,
  type CreatorCertificate,
} from "./creator-certificates-api";
import { downloadCertificate } from "./download-certificate";
import { saveCertificate } from "./save-certificate";
export function CreatorCertificates({ creatorId }: { creatorId: string }) {
  const active = useScreenActive();
  return active ? <CertificateList key={creatorId} creatorId={creatorId} /> : null;
}
function CertificateList({ creatorId }: { creatorId: string }) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const [rows, setRows] = useState<CreatorCertificate[]>(),
    [error, setError] = useState<string>(),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState<CreatorCertificate>();
  const [openError, setOpenError] = useState<string>();
  const openSequence = useRef(0);
  const download = useRef<AbortController | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const closePreview = () => {
    openSequence.current += 1;
    download.current?.abort();
    download.current = undefined;
    setSaving(false);
    setSelected(undefined);
  };
  useEffect(
    () => () => {
      openSequence.current += 1;
      download.current?.abort();
      download.current = undefined;
    },
    []
  );
  useEffect(() => {
    const c = new AbortController();
    void listCreatorCertificates(creatorId, c.signal).then(
      (v) => {
        if (!c.signal.aborted) setRows(v);
      },
      (e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => c.abort();
  }, [creatorId, revision]);
  const date = (value: string) => new Date(value).toLocaleDateString(locale);
  const image = publicCertificateImage(selected?.imageUrl ?? null);
  return (
    <View style={{ gap: 12 }}>
      <SectionHeader
        title={t("creatorCertificates.title")}
        trailing={rows ? String(rows.length) : undefined}
      />
      {error ? (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setError(undefined);
              setRevision((n) => n + 1);
            }}
          >
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </>
      ) : !rows ? (
        <ActivityIndicator />
      ) : rows.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t("creatorCertificates.empty")}
        </ThemedText>
      ) : (
        rows.map((row) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={`${t("creatorCertificates.preview")}: ${row.title}`}
            onPress={() => {
              openSequence.current += 1;
              setOpenError(undefined);
              setSelected(row);
            }}
            style={{
              padding: 12,
              gap: 6,
              borderRadius: 8,
              backgroundColor: theme.backgroundElement,
            }}
          >
            <ThemedText type="smallBold">{row.title}</ThemedText>
            <ThemedText type="small">{row.issuer}</ThemedText>
            <ThemedText type="small">{row.certNo}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t("creatorCertificates.issued")}: {date(row.issuedAt)}
            </ThemedText>
          </Pressable>
        ))
      )}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={closePreview}>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: 16,
            backgroundColor: "rgba(0,0,0,0.8)",
          }}
        >
          <ScrollView
            style={{ maxHeight: "90%", backgroundColor: theme.background, borderRadius: 8 }}
            contentContainerStyle={{ padding: 16, gap: 12 }}
          >
            <Pressable accessibilityRole="button" onPress={closePreview}>
              <ThemedText>{t("creatorCertificates.close")}</ThemedText>
            </Pressable>
            {selected && (
              <>
                <ThemedText type="smallBold">{selected.title}</ThemedText>
                <ThemedText>{selected.certNo}</ThemedText>
                <ThemedText>{selected.issuer}</ThemedText>
                {selected.description && <ThemedText>{selected.description}</ThemedText>}
                {selected.program && <ThemedText>{selected.program}</ThemedText>}
                <ThemedText>
                  {t("creatorCertificates.issued")}: {date(selected.issuedAt)}
                </ThemedText>
                {selected.validUntil && (
                  <ThemedText>
                    {t("creatorCertificates.validUntil")}: {date(selected.validUntil)}
                  </ThemedText>
                )}
                {image ? (
                  <>
                    <Image
                      source={{ uri: image }}
                      contentFit="contain"
                      accessibilityLabel={selected.title}
                      style={{ width: "100%", height: 300 }}
                    />
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        const sequence = ++openSequence.current;
                        void WebBrowser.openBrowserAsync(image).catch((e) => {
                          if (sequence === openSequence.current)
                            setOpenError(e instanceof Error ? e.message : String(e));
                        });
                      }}
                    >
                      <ThemedText>{t("creatorCertificates.openOriginal")}</ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={saving}
                      onPress={() => {
                        if (download.current) return;
                        const c = new AbortController();
                        download.current = c;
                        setSaving(true);
                        setOpenError(undefined);
                        void downloadCertificate(image, selected.certNo, c.signal)
                          .then((file) => saveCertificate(file, () => !c.signal.aborted))
                          .catch((e) => {
                            if (!c.signal.aborted)
                              setOpenError(e instanceof Error ? e.message : String(e));
                          })
                          .finally(() => {
                            if (download.current === c) {
                              download.current = undefined;
                              setSaving(false);
                            }
                          });
                      }}
                    >
                      <ThemedText>
                        {t(saving ? "creatorCertificates.saving" : "creatorCertificates.save")}
                      </ThemedText>
                    </Pressable>
                  </>
                ) : (
                  <ThemedText>{t("creatorCertificates.imageUnavailable")}</ThemedText>
                )}
                {openError && <ThemedText accessibilityRole="alert">{openError}</ThemedText>}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
