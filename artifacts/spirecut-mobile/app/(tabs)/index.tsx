import React from 'react';
import {
  Image,
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

export default function HomeScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const navigate = (path: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(path as never);
  };

  const advantages = t.home.advantages as unknown as string[];

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.muted }]}
      contentContainerStyle={{ paddingBottom: bottomPad + 20 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: colors.heroBackground, paddingTop: topPad + 20 }]}>
        {/* Logo / brand name + language toggle */}
        <View style={styles.logoRow}>
          <Image
            source={require('../../assets/images/spirecut-logo.webp')}
            accessibilityLabel={t.home.logoAccessibilityLabel}
            style={styles.logo}
            resizeMode="contain"
          />
          <View style={{ flex: 1 }} />
          <LanguageToggle />
        </View>

        <Text style={[styles.heroTitle, { color: colors.foreground }]}>
          {t.home.heroTitle}
        </Text>
        <Text style={[styles.heroSubtitle, { color: colors.foreground }]}>
          {t.home.heroSubtitle}
        </Text>
        <Text style={[styles.heroPara, { color: colors.mutedForeground }]}>
          {t.home.heroPara}
        </Text>

        <Pressable
          style={[styles.heroCta, { backgroundColor: colors.primary }]}
          onPress={() => navigate('/arzt')}
        >
          <Feather name="map-pin" size={16} color={colors.primaryForeground} />
          <Text style={[styles.heroCtaText, { color: colors.primaryForeground }]}>
            {t.home.findDoctorBtn}
          </Text>
        </Pressable>
      </View>

      {/* Conditions */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {t.home.conditionsTitle}
        </Text>
        <View style={styles.cardsRow}>
          <ConditionCard
            title={t.home.ctTitle}
            desc={t.home.ctDesc}
            icon="activity"
            onPress={() => navigate('/karpaltunnel')}
            colors={colors}
          />
          <ConditionCard
            title={t.home.tfTitle}
            desc={t.home.tfDesc}
            icon="zap"
            onPress={() => navigate('/schnappfinger')}
            colors={colors}
          />
        </View>
      </View>

      {/* Advantages */}
      <View style={[styles.section, styles.sectionAlt, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {t.home.advantagesTitle}
        </Text>
        {advantages.map((adv, i) => (
          <View key={i} style={styles.advantageRow}>
            <View style={[styles.check, { backgroundColor: colors.primary }]}>
              <Feather name="check" size={12} color={colors.primaryForeground} />
            </View>
            <Text style={[styles.advantageText, { color: colors.foreground }]}>{adv}</Text>
          </View>
        ))}
      </View>

      {/* How it works CTA */}
      <View style={styles.section}>
        <Pressable
          style={[styles.featureCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => navigate('/how-it-works')}
        >
          <View style={[styles.featureIcon, { backgroundColor: `${colors.primary}15` }]}>
            <Feather name="info" size={24} color={colors.primary} />
          </View>
          <View style={styles.featureText}>
            <Text style={[styles.featureTitle, { color: colors.foreground }]}>
              {t.home.howItWorksTitle}
            </Text>
            <Text style={[styles.featureDesc, { color: colors.mutedForeground }]}>
              {t.home.howItWorksDesc}
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Postop survey CTA */}
      <View style={[styles.section, { paddingTop: 0 }]}>
        <Pressable
          style={[styles.featureCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => navigate('/postop')}
        >
          <View style={[styles.featureIcon, { backgroundColor: `${colors.primary}15` }]}>
            <Feather name="clipboard" size={24} color={colors.primary} />
          </View>
          <View style={styles.featureText}>
            <Text style={[styles.featureTitle, { color: colors.foreground }]}>
              {t.home.postopTitle}
            </Text>
            <Text style={[styles.featureDesc, { color: colors.mutedForeground }]}>
              {t.home.postopDesc}
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
          {(t.home.footerCopyright as (year: number) => string)(new Date().getFullYear())}
        </Text>
      </View>
    </ScrollView>
  );
}

function ConditionCard({
  title,
  desc,
  icon,
  onPress,
  colors,
}: {
  title: string;
  desc: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.condCard,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
      ]}
      onPress={onPress}
    >
      <View style={[styles.condIcon, { backgroundColor: `${colors.primary}15` }]}>
        <Feather name={icon} size={22} color={colors.primary} />
      </View>
      <Text style={[styles.condTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.condDesc, { color: colors.mutedForeground }]}>{desc}</Text>
      <View style={styles.condLearnMore}>
        <Feather name="arrow-right" size={14} color={colors.primary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  hero: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
  },
  logo: {
    width: 184,
    height: 40,
  },
  heroTitle: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    lineHeight: 36,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 12,
    lineHeight: 22,
  },
  heroPara: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    marginBottom: 24,
  },
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 8,
  },
  heroCtaText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  sectionAlt: {
    marginTop: 24,
    paddingVertical: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    marginBottom: 16,
  },
  cardsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  condCard: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  condIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  condTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 20,
  },
  condDesc: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
    flex: 1,
  },
  condLearnMore: {
    marginTop: 4,
  },
  advantageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  advantageText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    flex: 1,
    lineHeight: 20,
  },
  featureCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
    gap: 4,
  },
  featureTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  featureDesc: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 32,
    paddingBottom: 8,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
});
