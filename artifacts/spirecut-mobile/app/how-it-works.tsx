import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Feather } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

export default function HowItWorksScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const how = t.how;
  const steps = how.steps as unknown as { step: string; title: string; desc: string }[];

  return (
    <>
    <Stack.Screen
      options={{
        title: t.nav.howItWorks,
        headerRight: () => <LanguageToggle />,
      }}
    />
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.muted }]}
      contentContainerStyle={{ paddingBottom: bottomPad + 24 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: colors.primary }]}>
        <Text style={[styles.heroTitle, { color: colors.primaryForeground }]}>{how.heroTitle}</Text>
        <Text style={[styles.heroDesc, { color: 'rgba(255,255,255,0.85)' }]}>{how.heroDesc}</Text>
      </View>

      {/* Steps */}
      <View style={styles.stepsContainer}>
        {steps.map((step, i) => (
          <View key={i} style={styles.stepRow}>
            {/* Step number + connector */}
            <View style={styles.stepLeft}>
              <View style={[styles.stepCircle, { backgroundColor: colors.primary }]}>
                <Text style={[styles.stepNum, { color: colors.primaryForeground }]}>{step.step}</Text>
              </View>
              {i < steps.length - 1 && (
                <View style={[styles.connector, { backgroundColor: colors.border }]} />
              )}
            </View>

            {/* Step content */}
            <View style={[styles.stepCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.stepTitle, { color: colors.foreground }]}>{step.title}</Text>
              <Text style={[styles.stepDesc, { color: colors.mutedForeground }]}>{step.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Key facts strip */}
      <View style={[styles.factsRow, { backgroundColor: colors.card, borderTopColor: colors.border, borderBottomColor: colors.border }]}>
        {[
          { icon: 'clock' as const, label: how.facts.duration },
          { icon: 'shield' as const, label: how.facts.guidance },
          { icon: 'sun' as const, label: how.facts.recovery },
        ].map((fact, i) => (
          <View key={i} style={[styles.factItem, i > 0 ? { borderLeftWidth: 1, borderLeftColor: colors.border } : {}]}>
            <Feather name={fact.icon} size={20} color={colors.primary} />
            <Text style={[styles.factLabel, { color: colors.foreground }]}>{fact.label}</Text>
          </View>
        ))}
      </View>

      {/* CTA */}
      <View style={[styles.ctaCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.ctaTitle, { color: colors.foreground }]}>{how.ctaTitle}</Text>
        <Pressable
          style={[styles.ctaBtn, { backgroundColor: colors.primary }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/arzt' as never);
          }}
        >
          <Feather name="map-pin" size={16} color={colors.primaryForeground} />
          <Text style={[styles.ctaBtnText, { color: colors.primaryForeground }]}>{how.ctaBtn}</Text>
        </Pressable>
      </View>
    </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  hero: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 28,
  },
  heroTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', lineHeight: 30, marginBottom: 10 },
  heroDesc: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  stepsContainer: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 0,
  },
  stepLeft: {
    alignItems: 'center',
    width: 44,
  },
  stepCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNum: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  connector: {
    width: 2,
    flex: 1,
    minHeight: 24,
    marginVertical: 4,
  },
  stepCard: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    gap: 6,
  },
  stepTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  stepDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  factsRow: {
    flexDirection: 'row',
    marginHorizontal: 0,
    marginTop: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 16,
  },
  factItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  factLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  ctaCard: {
    margin: 16,
    marginTop: 20,
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    gap: 14,
    alignItems: 'center',
  },
  ctaTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 8,
  },
  ctaBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
