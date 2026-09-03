import type { ReactNode } from "react";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

import type {
  AgentCardKind,
  AgentMessage,
  AgentPipelineCard,
  StoryTranscriptArtifact,
} from "../types";
import { AgentOsMarkdown } from "./agent-os-markdown";

type AppSymbol = SymbolViewProps["name"];

const CARD_ICON: Record<AgentCardKind, AppSymbol> = {
  world_spec: { ios: "globe", android: "public", web: "public" },
  world_cover: { ios: "sparkles", android: "auto_awesome", web: "auto_awesome" },
  script: { ios: "book", android: "menu_book", web: "menu_book" },
  character: { ios: "person.fill", android: "person", web: "person" },
  stage: { ios: "chart.bar", android: "bar_chart", web: "bar_chart" },
};

export function AgentMessageList({
  messages,
  renderStoryArtifact,
}: {
  messages: AgentMessage[];
  renderStoryArtifact?: (artifact: StoryTranscriptArtifact) => ReactNode;
}) {
  return (
    <View style={styles.list}>
      {messages.map((message) => (
        <AgentMessageBlock
          key={message.id}
          message={message}
          renderStoryArtifact={renderStoryArtifact}
        />
      ))}
    </View>
  );
}

function AgentMessageBlock({
  message,
  renderStoryArtifact,
}: {
  message: AgentMessage;
  renderStoryArtifact?: (artifact: StoryTranscriptArtifact) => ReactNode;
}) {
  const theme = useTheme();
  const t = useTranslations();
  const isUser = message.role === "user";
  const assistantText =
    message.text && message.text.trim() === t("agent.proposal.assets.legacyReadyMessage")
      ? t("agent.proposal.assets.mobileReadyMessage")
      : message.text;

  return (
    <View style={[styles.block, isUser && styles.blockUser]}>
      {assistantText ? (
        <View
          style={[
            styles.bubble,
            isUser
              ? { backgroundColor: theme.backgroundSelected, alignSelf: "flex-end" }
              : styles.bubbleAssistant,
          ]}
        >
          {isUser ? (
            <ThemedText type="small" style={[styles.bubbleText, { color: theme.text }]}>
              {assistantText}
            </ThemedText>
          ) : (
            <AgentOsMarkdown>{assistantText}</AgentOsMarkdown>
          )}
        </View>
      ) : null}

      {message.artifacts?.length && renderStoryArtifact
        ? message.artifacts.map((artifact) => (
            <View key={artifact.id} style={styles.artifact}>
              {renderStoryArtifact(artifact)}
            </View>
          ))
        : null}

      {message.cards?.length ? (
        <View style={styles.cards}>
          {message.cards.map((card) => (
            <PipelineCard key={card.id} card={card} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PipelineCard({ card }: { card: AgentPipelineCard }) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.cardRow}>
        <View style={[styles.cardIcon, { backgroundColor: theme.backgroundSelected }]}>
          <SymbolView name={CARD_ICON[card.kind]} size={16} tintColor={theme.brand} />
        </View>
        <View style={styles.cardCopy}>
          <ThemedText type="smallBold" numberOfLines={2}>
            {card.title}
          </ThemedText>
          {card.detail ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {card.detail}
            </ThemedText>
          ) : null}
        </View>
        {card.actionLabel ? (
          <ThemedText type="small" style={{ color: theme.brand }}>
            {card.actionLabel} ›
          </ThemedText>
        ) : (
          <SymbolView
            name={{ ios: "chevron.down", android: "expand_more", web: "expand_more" }}
            size={16}
            tintColor={theme.textSecondary}
          />
        )}
      </View>
      {card.imageUrl ? (
        <Image source={{ uri: card.imageUrl }} style={styles.cardImage} contentFit="cover" />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.four,
  },
  block: {
    gap: Spacing.two,
    alignItems: "stretch",
  },
  blockUser: {
    alignItems: "flex-end",
  },
  bubble: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    maxWidth: "88%",
  },
  bubbleAssistant: {
    alignSelf: "stretch",
    backgroundColor: "transparent",
    maxWidth: "100%",
    paddingHorizontal: 0,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
  },
  cards: {
    gap: Spacing.two,
    width: "100%",
  },
  artifact: {
    alignSelf: "stretch",
    width: "100%",
  },
  card: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  pressed: {
    opacity: 0.85,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  cardIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cardCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cardImage: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 6,
  },
});
