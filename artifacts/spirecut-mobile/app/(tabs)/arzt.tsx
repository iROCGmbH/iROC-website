import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLanguage, type Translations } from '@/context/LanguageContext';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import {
  DOCTOR_RADIUS_OPTIONS,
  fetchDoctors,
  filterDoctorsByRadius,
  geocodePostal,
  type DoctorRadiusKm,
  type GeoCoordinates,
  type TrainedDoctor,
} from '@/lib/api';
import * as Haptics from 'expo-haptics';

function countryCodeForSearch(country: string | null): string {
  const normalized = country?.toLowerCase();
  return normalized === 'at' || normalized === 'austria' || normalized === 'österreich' ? 'at' : 'de';
}

function countryLabel(
  country: string,
  countries: Translations['findDoctor']['countries'],
) {
  const entry = countries[country.toUpperCase() as keyof typeof countries];
  if (entry) return entry;
  return country;
}

export default function ArztFindenScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const fd = t.findDoctor;

  const [search, setSearch] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [postalInput, setPostalInput] = useState('');
  const [radiusKm, setRadiusKm] = useState<DoctorRadiusKm>(50);
  const [postalOrigin, setPostalOrigin] = useState<(GeoCoordinates & { label: string }) | null>(null);
  const [postalSearchError, setPostalSearchError] = useState(false);
  const [isPostalSearching, setIsPostalSearching] = useState(false);

  const { data: doctors, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ['doctors', 'spirecut'],
    queryFn: fetchDoctors,
    retry: 2,
    staleTime: 10 * 60 * 1000,
  });

  // Derive countries list
  const countries = useMemo(() => {
    if (!doctors) return [];
    const set = new Set(doctors.map((d) => d.country));
    return Array.from(set).sort();
  }, [doctors]);

  // Filter by country and search
  const filtered = useMemo(() => {
    if (!doctors) return [];
    let result = doctors;
    if (selectedCountry) result = result.filter((d) => d.country === selectedCountry);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.city.toLowerCase().includes(q) ||
          d.firstName.toLowerCase().includes(q) ||
          d.lastName.toLowerCase().includes(q) ||
          (d.institutionName ?? '').toLowerCase().includes(q) ||
          (d.postalCode ?? '').toLowerCase().includes(q),
      );
    }
    return result;
  }, [doctors, selectedCountry, search]);

  const doctorsWithDistance = useMemo(() => {
    if (!postalOrigin) return filtered.map((doctor) => ({ doctor, distanceKm: undefined }));

    return filterDoctorsByRadius(filtered, postalOrigin, radiusKm);
  }, [filtered, postalOrigin, radiusKm]);

  // Group by country for the default view
  const grouped = useMemo(() => {
    const map: Record<string, TrainedDoctor[]> = {};
    for (const d of filtered) {
      if (!map[d.country]) map[d.country] = [];
      map[d.country].push(d);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const handlePostalSearch = async () => {
    const postal = postalInput.trim();
    if (!postal || isPostalSearching) return;

    setIsPostalSearching(true);
    setPostalSearchError(false);

    try {
      const coords = await geocodePostal(postal, countryCodeForSearch(selectedCountry));
      setPostalOrigin({ ...coords, label: postal });
    } catch {
      setPostalOrigin(null);
      setPostalSearchError(true);
    } finally {
      setIsPostalSearching(false);
    }
  };

  const clearPostalSearch = () => {
    setPostalInput('');
    setPostalOrigin(null);
    setPostalSearchError(false);
  };

  const openUrl = (url: string) => {
    let href = url;
    if (!href.startsWith('http')) href = `https://${href}`;
    Linking.openURL(href).catch(() => {});
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.muted }]}>
      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: colors.primary, paddingTop: topPad + 16 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 }}>
          <LanguageToggle />
        </View>
        <Text style={[styles.heroTitle, { color: colors.primaryForeground }]}>{fd.heroTitle}</Text>
        <Text style={[styles.heroDesc, { color: 'rgba(255,255,255,0.85)' }]}>{fd.heroDesc}</Text>

        {/* Name, city or postal-code search */}
        <View style={[styles.searchBar, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.7)" />
          <TextInput
            style={[styles.searchInput, { color: colors.primaryForeground }]}
            placeholder={fd.searchPlaceholder}
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')}>
              <Feather name="x" size={16} color="rgba(255,255,255,0.7)" />
            </Pressable>
          )}
        </View>
        <View style={styles.postalSearch}>
          <View style={[styles.postalInputWrap, { backgroundColor: colors.card }]}>
            <Feather name="map-pin" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.postalInput, { color: colors.foreground }]}
              placeholder={fd.postalPlaceholder}
              placeholderTextColor={colors.mutedForeground}
              value={postalInput}
              onChangeText={(value) => {
                setPostalInput(value);
                if (postalSearchError) setPostalSearchError(false);
              }}
              keyboardType="number-pad"
              returnKeyType="search"
              onSubmitEditing={() => { void handlePostalSearch(); }}
              maxLength={10}
            />
            {postalInput.length > 0 && (
              <Pressable
                accessibilityLabel={fd.clearSearch}
                onPress={clearPostalSearch}
                hitSlop={8}
              >
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>
          <Pressable
            style={[
              styles.postalSearchButton,
              { backgroundColor: colors.card, opacity: !postalInput.trim() || isPostalSearching ? 0.55 : 1 },
            ]}
            onPress={() => { void handlePostalSearch(); }}
            disabled={!postalInput.trim() || isPostalSearching}
            accessibilityRole="button"
          >
            {isPostalSearching ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="search" size={16} color={colors.primary} />
            )}
            <Text style={[styles.postalSearchButtonText, { color: colors.primary }]}>{fd.searchButton}</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.radiusContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.radiusLabel, { color: 'rgba(255,255,255,0.75)' }]}>{fd.radiusLabel}</Text>
          {DOCTOR_RADIUS_OPTIONS.map((radius) => (
            <Pressable
              key={radius}
              style={[
                styles.radiusPill,
                {
                  backgroundColor: radiusKm === radius ? colors.card : 'rgba(255,255,255,0.12)',
                  borderColor: radiusKm === radius ? colors.card : 'rgba(255,255,255,0.28)',
                },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setRadiusKm(radius);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: radiusKm === radius }}
            >
              <Text style={[styles.radiusText, { color: radiusKm === radius ? colors.primary : colors.primaryForeground }]}>
                {radius} km
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {postalSearchError && (
          <Text style={[styles.postalError, { color: colors.primaryForeground }]}>{fd.postalNotFound}</Text>
        )}
      </View>

      {/* Country filter */}
      {countries.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.filterRow, { backgroundColor: colors.card }]}
          contentContainerStyle={styles.filterContent}
        >
          <Pressable
            style={[
              styles.filterPill,
              {
                backgroundColor: selectedCountry === null ? colors.primary : colors.muted,
                borderColor: selectedCountry === null ? colors.primary : colors.border,
              },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setSelectedCountry(null);
              clearPostalSearch();
            }}
          >
            <Text style={[styles.filterText, { color: selectedCountry === null ? colors.primaryForeground : colors.foreground }]}>
              {fd.countryAll}
            </Text>
          </Pressable>
          {countries.map((c) => (
            <Pressable
              key={c}
              style={[
                styles.filterPill,
                {
                  backgroundColor: selectedCountry === c ? colors.primary : colors.muted,
                  borderColor: selectedCountry === c ? colors.primary : colors.border,
                },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelectedCountry(selectedCountry === c ? null : c);
                clearPostalSearch();
              }}
            >
              <Text style={[styles.filterText, { color: selectedCountry === c ? colors.primaryForeground : colors.foreground }]}>
                {countryLabel(c, fd.countries)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Content */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad + 20, paddingTop: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => { void refetch(); }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {isLoading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>{fd.loading}</Text>
          </View>
        )}

        {isError && (
          <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="alert-circle" size={28} color={colors.primary} />
            <Text style={[styles.errorText, { color: colors.foreground }]}>{fd.error}</Text>
            <Pressable
              style={[styles.retryBtn, { backgroundColor: colors.primary }]}
              onPress={() => refetch()}
            >
              <Text style={[styles.retryText, { color: colors.primaryForeground }]}>{fd.retry}</Text>
            </Pressable>
          </View>
        )}

        {!isLoading && !isError && postalOrigin && !postalSearchError && (
          <Text style={[styles.resultsSummary, { color: colors.mutedForeground }]}>
            {fd.resultsSummary(doctorsWithDistance.length, radiusKm, postalOrigin.label)}
          </Text>
        )}

        {!isLoading && !isError && postalOrigin && !postalSearchError && doctorsWithDistance.length === 0 && (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="map-pin" size={28} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{fd.noNearbyDoctors}</Text>
          </View>
        )}

        {!isLoading && !isError && !postalOrigin && grouped.length === 0 && (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="users" size={28} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{fd.noDoctors}</Text>
          </View>
        )}

        {postalOrigin && !postalSearchError
          ? doctorsWithDistance.map(({ doctor, distanceKm }) => (
            <DoctorCard
              key={doctor.id}
              doc={doctor}
              colors={colors}
              websiteLabel={fd.practiceWebsite}
              onOpenUrl={openUrl}
              distanceKm={distanceKm ?? undefined}
            />
          ))
          : grouped.map(([country, docs]) => (
            <View key={country}>
              <Text style={[styles.countryHeader, { color: colors.mutedForeground }]}>
                {countryLabel(country, fd.countries).toUpperCase()}
              </Text>
              {docs.map((doc) => (
                <DoctorCard
                  key={doc.id}
                  doc={doc}
                  colors={colors}
                  websiteLabel={fd.practiceWebsite}
                  onOpenUrl={openUrl}
                />
              ))}
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

function DoctorCard({
  doc,
  colors,
  websiteLabel,
  onOpenUrl,
  distanceKm,
}: {
  doc: TrainedDoctor;
  colors: ReturnType<typeof useColors>;
  websiteLabel: string;
  onOpenUrl: (url: string) => void;
  distanceKm?: number;
}) {
  const fullName = [doc.title, doc.firstName, doc.lastName].filter(Boolean).join(' ');
  const location = [doc.postalCode, doc.city].filter(Boolean).join(' ');

  return (
    <View style={[styles.doctorCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.doctorAvatar, { backgroundColor: `${colors.primary}15` }]}>
        <Feather name="user" size={20} color={colors.primary} />
      </View>
      <View style={styles.doctorInfo}>
        <Text style={[styles.doctorName, { color: colors.foreground }]}>{fullName}</Text>
        {doc.specialty && (
          <Text style={[styles.doctorSpecialty, { color: colors.mutedForeground }]}>{doc.specialty}</Text>
        )}
        {doc.institutionName && (
          <Text style={[styles.doctorInstitution, { color: colors.mutedForeground }]}>
            {doc.institutionName}
          </Text>
        )}
        <View style={styles.doctorLocation}>
          <Feather name="map-pin" size={12} color={colors.mutedForeground} />
          <Text style={[styles.doctorLocationText, { color: colors.mutedForeground }]}>{location}</Text>
        </View>
        {distanceKm !== undefined && (
          <Text style={[styles.distanceText, { color: colors.primary }]}>
            ~{Math.round(distanceKm)} km
          </Text>
        )}
        {doc.websiteUrl && (
          <Pressable
            style={[styles.websiteBtn, { borderColor: colors.border }]}
            onPress={() => onOpenUrl(doc.websiteUrl!)}
          >
            <Feather name="external-link" size={12} color={colors.primary} />
            <Text style={[styles.websiteBtnText, { color: colors.primary }]}>{websiteLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  heroTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', marginBottom: 6 },
  heroDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20, marginBottom: 16 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  postalSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  postalInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 42,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  postalInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  postalSearchButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    borderRadius: 8,
  },
  postalSearchButtonText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  radiusContent: {
    alignItems: 'center',
    gap: 7,
    paddingTop: 12,
  },
  radiusLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', marginRight: 2 },
  radiusPill: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  radiusText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  postalError: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 9 },
  filterRow: {
    maxHeight: 52,
    borderBottomWidth: 1,
  },
  filterContent: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  list: { flex: 1 },
  countryHeader: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.2,
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 4,
  },
  resultsSummary: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    marginTop: 5,
    marginBottom: 4,
    marginLeft: 4,
  },
  doctorCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  doctorAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  doctorInfo: { flex: 1, gap: 3 },
  doctorName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  doctorSpecialty: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  doctorInstitution: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  doctorLocation: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  doctorLocationText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  distanceText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 3 },
  websiteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
  },
  websiteBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  center: { paddingVertical: 60, alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  errorCard: {
    marginTop: 40,
    marginHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  errorText: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  retryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  emptyCard: {
    marginTop: 40,
    borderRadius: 12,
    borderWidth: 1,
    padding: 40,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center' },
});
