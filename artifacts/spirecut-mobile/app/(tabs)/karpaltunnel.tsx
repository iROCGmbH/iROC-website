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
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

export default function KarpaltunnelScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const ct = t.ct;
  const symptoms = ct.symptoms as unknown as string[];
  const classicItems = ct.classicItems as unknown as string[];
  const modernItems = ct.modernItems as unknown as [string, string][];

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.muted }]}
      contentContainerStyle={{ paddingBottom: bottomPad + 20 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: colors.primary, paddingTop: topPad + 16 }]}>
        <View style={{ alignItems: 'flex-end', marginBottom: 10 }}>
          <LanguageToggle />
        </View>
        <View style={[styles.badge, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
          <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>{ct.badge}</Text>
        </View>
        <Text style={[styles.heroTitle, { color: colors.primaryForeground }]}>{ct.heroTitle}</Text>
        <Text style={[styles.heroDesc, { color: 'rgba(255,255,255,0.85)' }]}>{ct.heroDesc}</Text>
        <Pressable
          style={[styles.heroBtn, { backgroundColor: colors.primaryForeground }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/arzt' as never); }}
        >
          <Feather name="map-pin" size={14} color={colors.primary} />
          <Text style={[styles.heroBtnText, { color: colors.primary }]}>{ct.findNearby}</Text>
        </Pressable>
      </View>

      {/* What is it */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{ct.whatTitle}</Text>
        <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{ct.whatDesc}</Text>
      </View>

      {/* Symptoms */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{ct.symptomsTitle}</Text>
        {symptoms.map((s, i) => (
          <View key={i} style={styles.symptomRow}>
            <View style={[styles.dot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.symptomText, { color: colors.foreground }]}>{s}</Text>
          </View>
        ))}
      </View>

      {/* Treatment comparison */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{ct.treatmentTitle}</Text>
      </View>

      {/* Classic */}
      <View style={[styles.compCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.compHeader}>
          <Feather name="x-circle" size={18} color={colors.mutedForeground} />
          <Text style={[styles.compTitle, { color: colors.mutedForeground }]}>{ct.classicTitle}</Text>
        </View>
        {classicItems.map((item, i) => (
          <View key={i} style={styles.compRow}>
            <Feather name="x" size={14} color={colors.mutedForeground} />
            <Text style={[styles.compText, { color: colors.mutedForeground }]}>{item}</Text>
          </View>
        ))}
      </View>

      {/* Modern */}
      <View style={[styles.compCard, styles.modernCard, { backgroundColor: colors.primary }]}>
        <View style={styles.compHeader}>
          <Feather name="check-circle" size={18} color={colors.primaryForeground} />
          <Text style={[styles.compTitle, { color: colors.primaryForeground }]}>{ct.modernTitle}</Text>
        </View>
        {modernItems.map(([head, sub], i) => (
          <View key={i} style={styles.modernRow}>
            <Feather name="check" size={14} color={colors.primaryForeground} />
            <View style={styles.modernTexts}>
              <Text style={[styles.modernHead, { color: colors.primaryForeground }]}>{head}</Text>
              <Text style={[styles.modernSub, { color: 'rgba(255,255,255,0.7)' }]}>{sub}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* CTA */}
      <View style={[styles.ctaSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.ctaTitle, { color: colors.foreground }]}>{ct.ctaTitle}</Text>
        <Text style={[styles.ctaDesc, { color: colors.mutedForeground }]}>{ct.ctaDesc}</Text>
        <View style={styles.ctaButtons}>
          <Pressable
            style={[styles.ctaBtn, { backgroundColor: colors.primary }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/arzt' as never); }}
          >
            <Feather name="map-pin" size={14} color={colors.primaryForeground} />
            <Text style={[styles.ctaBtnText, { color: colors.primaryForeground }]}>{ct.findNearby}</Text>
          </Pressable>
          <Pressable
            style={[styles.ctaBtn, styles.ctaBtnOutline, { borderColor: colors.border }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/how-it-works' as never); }}
          >
            <Feather name="info" size={14} color={colors.foreground} />
            <Text style={[styles.ctaBtnText, { color: colors.foreground }]}>{ct.howItWorks}</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  hero: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 12,
  },
  badgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 },
  heroTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', lineHeight: 32, marginBottom: 10 },
  heroDesc: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22, marginBottom: 20 },
  heroBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
  },
  heroBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  card: {
    margin: 16,
    marginBottom: 0,
    borderRadius: 10,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  cardTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  cardBody: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  symptomRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8, flexShrink: 0 },
  symptomText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22, flex: 1 },
  sectionHeader: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 4 },
  sectionTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  compCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  modernCard: { borderWidth: 0 },
  compHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  compTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  compRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  compText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 20 },
  modernRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  modernTexts: { flex: 1 },
  modernHead: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  modernSub: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  ctaSection: {
    margin: 16,
    marginTop: 20,
    borderRadius: 10,
    borderWidth: 1,
    padding: 20,
    gap: 8,
  },
  ctaTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  ctaDesc: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  ctaButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
  },
  ctaBtnOutline: { borderWidth: 1 },
  ctaBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});
