import React, { useState } from 'react';
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

export default function FAQScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const faq = t.faq;
  const items = faq.items as unknown as { q: string; a: string }[];
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (i: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpenIndex(openIndex === i ? null : i);
  };

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
        <Text style={[styles.heroTitle, { color: colors.primaryForeground }]}>{faq.heroTitle}</Text>
        <Text style={[styles.heroDesc, { color: 'rgba(255,255,255,0.85)' }]}>{faq.heroDesc}</Text>
      </View>

      {/* Accordion */}
      <View style={styles.listContainer}>
        {items.map((item, i) => {
          const open = openIndex === i;
          return (
            <View
              key={i}
              style={[
                styles.item,
                { backgroundColor: colors.card, borderColor: open ? colors.primary : colors.border },
              ]}
            >
              <Pressable
                style={styles.itemHeader}
                onPress={() => toggle(i)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
              >
                <View style={styles.qNum}>
                  <Text style={[styles.qNumText, { color: open ? colors.primary : colors.mutedForeground }]}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.question,
                    { color: open ? colors.primary : colors.foreground },
                  ]}
                >
                  {item.q}
                </Text>
                <Feather
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={open ? colors.primary : colors.mutedForeground}
                />
              </Pressable>
              {open && (
                <View style={[styles.answerContainer, { borderTopColor: colors.border }]}>
                  <Text style={[styles.answer, { color: colors.mutedForeground }]}>{item.a}</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Not found */}
      <View style={[styles.notFoundCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="message-circle" size={28} color={colors.primary} />
        <Text style={[styles.notFoundTitle, { color: colors.foreground }]}>{faq.notFound}</Text>
        <Text style={[styles.notFoundDesc, { color: colors.mutedForeground }]}>{faq.notFoundDesc}</Text>
        <Pressable
          style={[styles.notFoundBtn, { backgroundColor: colors.primary }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/arzt' as never);
          }}
        >
          <Feather name="map-pin" size={14} color={colors.primaryForeground} />
          <Text style={[styles.notFoundBtnText, { color: colors.primaryForeground }]}>
            {faq.contactDoctor}
          </Text>
        </Pressable>
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
  heroTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', lineHeight: 34, marginBottom: 10 },
  heroDesc: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  listContainer: {
    padding: 16,
    gap: 10,
  },
  item: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  qNum: {
    width: 28,
  },
  qNumText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
  },
  question: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 20,
  },
  answerContainer: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 14,
  },
  answer: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  notFoundCard: {
    margin: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  notFoundTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginTop: 4,
  },
  notFoundDesc: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
    textAlign: 'center',
  },
  notFoundBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 6,
    marginTop: 8,
  },
  notFoundBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
