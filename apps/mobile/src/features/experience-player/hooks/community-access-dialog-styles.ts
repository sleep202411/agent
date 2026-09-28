import { StyleSheet } from "react-native";

export const communityAccessDialogStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 80,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
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
    gap: 8,
  },
  lockBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    marginBottom: 8,
  },
  title: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 17,
    fontWeight: "600",
  },
  description: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 14,
    lineHeight: 20,
  },
  price: {
    marginTop: 10,
    color: "#FFD84D",
    fontSize: 24,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  hint: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    lineHeight: 18,
  },
  previewHint: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  balance: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    lineHeight: 18,
  },
  error: {
    color: "rgba(254,202,202,0.92)",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  checkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  checking: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16,
  },
  secondaryHit: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  secondaryText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    fontWeight: "600",
  },
  primaryHit: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#EA2804",
  },
  primaryHitDisabled: {
    opacity: 0.45,
  },
  primaryText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
});
