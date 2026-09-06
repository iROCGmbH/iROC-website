import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLanguage, type Lang } from '@/context/LanguageContext';

export function LanguageToggle() {
  const colors = useColors();
  const { lang, setLang, t } = useLanguage();

  const btn = (l: Lang, label: string) => {
    const active = lang === l;
    return (
      <Pressable
        key={l}
        onPress={() => setLang(l)}
        style={[
          styles.pill,
          {
            backgroundColor: active ? colors.primary : 'transparent',
            borderColor: active ? colors.primary : colors.border,
          },
        ]}
        accessibilityLabel={t.languageToggle.switchTo(label)}
      >
        <Text
          style={[
            styles.label,
            { color: active ? colors.primaryForeground : colors.mutedForeground },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      style={[
        styles.container,
        { borderColor: colors.border, backgroundColor: colors.muted },
      ]}
    >
      {btn('de', 'DE')}
      {btn('en', 'EN')}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    marginRight: Platform.OS === 'web' ? 16 : 0,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 0,
  },
  label: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
  },
});
