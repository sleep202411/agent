import IconCircleCheck from "@tabler/icons-react-native/IconCircleCheck";
import IconRefresh from "@tabler/icons-react-native/IconRefresh";
import IconX from "@tabler/icons-react-native/IconX";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";

import { getBillingOrder, isOrderDead, isOrderFulfilled } from "../lib/billing-api";
import { MOCK_WECHAT_ORDER_PREFIX } from "../lib/purchase-types";

type ScanStatus = "pending" | "paid" | "expired";
const POLL_MS = 2500;
/** How long the mock QR stays up before the paid state (screenshot-scan demo). */
const MOCK_PAID_MS = 2_800;
const QR_SIZE = 224;

/**
 * In-app WeChat Native scan surface. Mirrors the web dialog: render the
 * `weixin://` code as a QR and poll the order (the server 查单-reconciles).
 */
export function WechatScanPay({
  orderId,
  codeUrl,
  amountLabel,
  onClose,
  onPaid,
}: {
  orderId: string;
  codeUrl: string;
  amountLabel?: string;
  onClose: () => void;
  onPaid: () => void;
}) {
  const t = useTranslations();
  const [status, setStatus] = useState<ScanStatus>("pending");
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  useEffect(() => {
    if (status !== "pending") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (orderId.startsWith(MOCK_WECHAT_ORDER_PREFIX)) {
      timer = setTimeout(() => {
        if (!alive) return;
        setStatus("paid");
        onPaidRef.current();
      }, MOCK_PAID_MS);
      return () => {
        alive = false;
        clearTimeout(timer);
      };
    }

    const tick = async () => {
      try {
        const order = await getBillingOrder(orderId);
        if (!alive) return;
        if (isOrderFulfilled(order.status)) {
          setStatus("paid");
          onPaidRef.current();
          return;
        } else if (isOrderDead(order.status)) {
          setStatus("expired");
          return;
        }
      } catch {
        // Transient — keep polling.
      }
      if (alive) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [orderId, status]);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <ThemedText type="smallBold">{t("paywall.wechat.title")}</ThemedText>
              {amountLabel ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {amountLabel}
                </ThemedText>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("paywall.wechat.close")}
              onPress={onClose}
              hitSlop={8}
            >
              <IconX size={18} color="rgba(255,255,255,0.72)" />
            </Pressable>
          </View>

          <View style={styles.body}>
            {status === "pending" ? (
              <>
                <View style={styles.qrFrame}>
                  <QRCode
                    value={codeUrl}
                    size={QR_SIZE}
                    color="#0C0E14"
                    backgroundColor="#FFFFFF"
                  />
                </View>
                <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                  {t("paywall.wechat.scan")}
                </ThemedText>
              </>
            ) : status === "paid" ? (
              <View style={styles.result}>
                <IconCircleCheck size={56} color="#FFFFFF" />
                <ThemedText type="smallBold">{t("paywall.wechat.success")}</ThemedText>
              </View>
            ) : (
              <View style={styles.result}>
                <IconRefresh size={44} color="rgba(255,255,255,0.72)" />
                <ThemedText type="smallBold">{t("paywall.wechat.failed")}</ThemedText>
                <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
                  <ThemedText type="smallBold">{t("paywall.wechat.close")}</ThemedText>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    backgroundColor: "#161616",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
    padding: 22,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  body: {
    marginTop: 20,
    alignItems: "center",
    gap: 16,
  },
  qrFrame: {
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    padding: 12,
  },
  center: {
    textAlign: "center",
  },
  result: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 28,
  },
  closeButton: {
    marginTop: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
