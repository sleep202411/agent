import { ServiceEditorNavigation } from "@/features/services/service-editor-navigation";
import { SERVICE_TIERS } from "@repo/shared/creator-service";
import { ServiceEditorDrafts } from "@/features/services/service-editor-drafts";
import { ServiceIntentProvider } from "@/features/services/service-intent";
import { ServicePackagesEditor } from "@/features/services/service-packages-editor";
import { ServiceQuestionsEditor } from "@/features/services/service-questions-editor";
import { ServiceDetailsEditor } from "@/features/services/service-details-editor";
import { ServiceOwnerActions } from "@/features/services/service-owner-actions";
import { ServiceOrder } from "@/features/services/service-order";
import { ServiceContact } from "@/features/services/service-contact";
import { Stack, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/auth";
import { useServiceDetail } from "@/features/services/use-service-detail";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, PosterImage, SectionHeader, Tag } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import type { CreatorServicePackage } from "@/data/types";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { formatServicePrice, serviceCategoryLabel } from "@/lib/creator-service-format";

export default function CreatorServiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  return (
    <ServiceIntentProvider key={id}>
      <ServiceEditorDrafts
        key={JSON.stringify([id, auth.generation, auth.status, auth.user?.userId ?? auth.user?.id])}
      >
        <ServiceEditorNavigation />
        <ServiceDetailContent id={id} />
      </ServiceEditorDrafts>
    </ServiceIntentProvider>
  );
}
function ServiceDetailContent({ id }: { id: string }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const locale = useLocale();
  const t = useTranslations();
  const auth = useAuth();
  const active = useScreenActive();
  const { service, loading, error, retry } = useServiceDetail(id, auth.generation, active);

  if (!active) return null;

  if (error)
    return (
      <ThemedView style={[styles.fullCenter, { padding: Spacing.four }]}>
        <ThemedText>{error}</ThemedText>
        <Pressable accessibilityRole="button" onPress={retry}>
          <ThemedText>{t("common.retry")}</ThemedText>
        </Pressable>
      </ThemedView>
    );

  if (loading) {
    return (
      <ThemedView style={styles.fullCenter}>
        <ActivityIndicator color={theme.textSecondary} />
      </ThemedView>
    );
  }

  if (!service) {
    return (
      <ThemedView style={[styles.fullCenter, { padding: Spacing.four }]}>
        <EmptyState
          title={t("serviceDetail.notFoundTitle")}
          detail={t("serviceDetail.notFoundDetail")}
          symbol={{ ios: "sparkles", android: "work", web: "work" }}
        />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerTitle: "",
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: theme.text,
        }}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.seven }}
      >
        {service.coverUrl ? (
          <View style={styles.cover}>
            <PosterImage
              uri={service.coverUrl}
              label={service.title}
              radius={0}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.scrim} />
            <View style={styles.coverCopy}>
              <View style={styles.tagRow}>
                <Tag label={serviceCategoryLabel(service.category, t)} />
                <Tag label={`${service.packageCount} ${t("creatorService.packagesShort")}`} />
              </View>
              <ThemedText type="subtitle" style={styles.title} numberOfLines={2}>
                {service.title}
              </ThemedText>
              {service.packages.length > 0 && (
                <ThemedText type="smallBold" style={{ color: theme.brand }}>
                  {t("creatorService.fromPrice")} {formatServicePrice(service, locale)}
                </ThemedText>
              )}
            </View>
          </View>
        ) : (
          <View style={[styles.plainHeader, { paddingTop: insets.top + Spacing.seven }]}>
            <View style={styles.tagRow}>
              <Tag label={serviceCategoryLabel(service.category, t)} />
              <Tag label={`${service.packageCount} ${t("creatorService.packagesShort")}`} />
            </View>
            <ThemedText type="subtitle" style={styles.title} numberOfLines={2}>
              {service.title}
            </ThemedText>
            {service.packages.length > 0 && (
              <ThemedText type="smallBold" style={{ color: theme.brand }}>
                {t("creatorService.fromPrice")} {formatServicePrice(service, locale)}
              </ThemedText>
            )}
          </View>
        )}

        <View style={styles.body}>
          <ServiceDetailsEditor service={service} refresh={retry} />
          <ServiceQuestionsEditor service={service} refresh={retry} />
          <ServicePackagesEditor service={service} refresh={retry} />
          <ServiceOwnerActions
            id={service.id}
            creatorId={service.creatorId}
            status={service.status}
            packageCount={service.packages.length}
            refresh={retry}
          />
          <ServiceContact
            key={service.id}
            serviceId={service.id}
            creatorId={service.creatorId}
            status={service.status}
          />
          <View style={styles.section}>
            <SectionHeader title={t("serviceDetail.overviewTitle")} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.paragraph}>
              {service.summary}
            </ThemedText>
            {service.tags.length ? (
              <View style={styles.tagWrap}>
                {service.tags.slice(0, 8).map((tag) => (
                  <Tag key={tag} label={tag} />
                ))}
              </View>
            ) : null}
          </View>

          <ServiceOrder key={`${service.id}-${service.version}`} service={service} />
          <View style={styles.section}>
            <SectionHeader title={t("serviceDetail.packagesTitle")} />
            {service.packages.length === 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                {t("serviceDetail.noPackages")}
              </ThemedText>
            )}
            <View style={styles.packageList}>
              {service.packages.map((pkg) => (
                <PackageCard key={pkg.id} pkg={pkg} locale={locale} />
              ))}
            </View>
          </View>

          {service.requirementQuestions.length ? (
            <View style={styles.section}>
              <SectionHeader title={t("serviceDetail.questionsTitle")} />
              <View style={styles.questionList}>
                {service.requirementQuestions.map((question) => (
                  <ThemedView key={question.id} type="backgroundElement" style={styles.question}>
                    <ThemedText type="smallBold">{question.prompt}</ThemedText>
                    {question.helpText ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {question.helpText}
                      </ThemedText>
                    ) : null}
                  </ThemedView>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function PackageCard({ pkg, locale }: { pkg: CreatorServicePackage; locale: string }) {
  const t = useTranslations();
  const theme = useTheme();
  const price = formatServicePrice({ currency: pkg.currency, startingPrice: pkg.price }, locale);
  const tier = SERVICE_TIERS.find((value) => value === pkg.tier);
  const revisions = pkg.revisions < 0 ? t("serviceDetail.unlimitedRevisions") : `${pkg.revisions}`;

  return (
    <ThemedView type="backgroundElement" style={styles.packageCard}>
      <View style={styles.packageTop}>
        <View style={styles.packageCopy}>
          <Tag label={tier ? t(`servicePackages.tier.${tier}`) : pkg.tier} tone="brand" />
          <ThemedText type="smallBold" numberOfLines={2}>
            {pkg.title}
          </ThemedText>
        </View>
        <ThemedText type="smallBold" style={{ color: theme.brand }}>
          {price}
        </ThemedText>
      </View>
      {pkg.description ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.paragraph}>
          {pkg.description}
        </ThemedText>
      ) : null}
      <View style={styles.packageMeta}>
        <Tag label={`${pkg.deliveryDays} ${t("serviceDetail.days")}`} />
        <Tag label={`${revisions} ${t("serviceDetail.revisions")}`} />
      </View>
      {pkg.scope.length ? (
        <View style={styles.scopeList}>
          {pkg.scope.map((item, index) => (
            <ThemedText key={index} type="code" themeColor="textSecondary">
              {`• ${item}`}
            </ThemedText>
          ))}
        </View>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fullCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  cover: {
    height: 280,
    justifyContent: "flex-end",
  },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(7,8,12,0.46)",
  },
  coverCopy: {
    gap: Spacing.two,
    padding: Spacing.four,
  },
  plainHeader: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  title: {
    fontSize: 28,
    lineHeight: 32,
  },
  body: {
    padding: Spacing.four,
    gap: Spacing.five,
  },
  section: {
    gap: Spacing.two,
  },
  paragraph: {
    lineHeight: 22,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
  },
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
  },
  packageList: {
    gap: Spacing.three,
  },
  packageCard: {
    borderRadius: 8,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  packageTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  packageCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.two,
  },
  packageMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
  },
  scopeList: {
    gap: Spacing.one,
  },
  questionList: {
    gap: Spacing.two,
  },
  question: {
    borderRadius: 8,
    padding: Spacing.three,
    gap: Spacing.one,
  },
});
