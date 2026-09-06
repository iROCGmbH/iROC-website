import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { useLanguage } from '@/context/LanguageContext';

// NativeTabs: iOS 26+ liquid glass tabs (no header — language toggle is in each screen's hero)
function NativeTabLayout() {
  const { t } = useLanguage();
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <Label>{t.nav.home}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="karpaltunnel">
        <Icon sf={{ default: 'hand.raised', selected: 'hand.raised.fill' }} />
        <Label>{t.nav.ctShort}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="schnappfinger">
        <Icon sf={{ default: 'hand.point.up.left', selected: 'hand.point.up.left.fill' }} />
        <Label>{t.nav.tfShort}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="faq">
        <Icon sf={{ default: 'questionmark.circle', selected: 'questionmark.circle.fill' }} />
        <Label>{t.nav.faq}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="arzt">
        <Icon sf={{ default: 'mappin.circle', selected: 'mappin.circle.fill' }} />
        <Label>{t.nav.findDoctor}</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

// Classic tabs: Android, web, older iOS
function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const { t } = useLanguage();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: {
          fontFamily: 'Inter_500Medium',
          fontSize: 10,
        },
        // No headerRight — language toggle lives in each screen's hero section
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.primaryForeground,
        headerTitleStyle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
        headerShown: false, // screens render their own top-safe-area hero with toggle
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.nav.home,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={22} />
            ) : (
              <Feather name="home" size={20} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="karpaltunnel"
        options={{
          title: t.nav.ctShort,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="hand.raised" tintColor={color} size={22} />
            ) : (
              <Feather name="activity" size={20} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="schnappfinger"
        options={{
          title: t.nav.tfShort,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="hand.point.up.left" tintColor={color} size={22} />
            ) : (
              <Feather name="zap" size={20} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="faq"
        options={{
          title: t.nav.faq,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="questionmark.circle" tintColor={color} size={22} />
            ) : (
              <Feather name="help-circle" size={20} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="arzt"
        options={{
          title: t.nav.findDoctor,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="mappin.circle" tintColor={color} size={22} />
            ) : (
              <Feather name="map-pin" size={20} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
