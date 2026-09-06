import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Feather } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation } from '@tanstack/react-query';
import { submitPostop } from '@/lib/api';
import * as Haptics from 'expo-haptics';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

// ─── Sub-components ───────────────────────────────────────────────────────────

function SelectRow({
  label,
  value,
  options,
  onSelect,
  colors,
  placeholder,
}: {
  label: string;
  value: string | null;
  options: { value: string; label: string }[];
  onSelect: (v: string | null) => void;
  colors: ReturnType<typeof useColors>;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      <Pressable
        style={[styles.selectBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setOpen(!open); }}
      >
        <Text style={[styles.selectText, { color: selected ? colors.foreground : colors.mutedForeground }]}>
          {selected ? selected.label : placeholder}
        </Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} />
      </Pressable>
      {open && (
        <View style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {options.map((opt) => (
            <Pressable
              key={opt.value}
              style={[
                styles.dropdownItem,
                { borderBottomColor: colors.border },
                opt.value === value ? { backgroundColor: `${colors.primary}10` } : {},
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onSelect(opt.value === value ? null : opt.value);
                setOpen(false);
              }}
            >
              <Text style={[styles.dropdownText, { color: opt.value === value ? colors.primary : colors.foreground }]}>
                {opt.label}
              </Text>
              {opt.value === value && <Feather name="check" size={14} color={colors.primary} />}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function StarRating({
  value,
  onChange,
  colors,
}: {
  value: number;
  onChange: (v: number) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable
          key={star}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onChange(star);
          }}
          style={styles.starBtn}
        >
          <Feather
            name="star"
            size={32}
            color={star <= value ? colors.primary : colors.border}
          />
        </Pressable>
      ))}
    </View>
  );
}

function MultiCheckbox({
  label,
  options,
  selected,
  onToggle,
  colors,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (v: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      <View style={styles.checkboxGrid}>
        {options.map((opt) => {
          const checked = selected.includes(opt.value);
          return (
            <Pressable
              key={opt.value}
              style={[
                styles.checkboxPill,
                {
                  backgroundColor: checked ? `${colors.primary}15` : colors.muted,
                  borderColor: checked ? colors.primary : colors.border,
                },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onToggle(opt.value);
              }}
            >
              {checked && <Feather name="check" size={12} color={colors.primary} />}
              <Text style={[styles.checkboxText, { color: checked ? colors.primary : colors.foreground }]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PostopScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const po = t.postop;
  const months = t.months as unknown as string[];

  // Form state
  const [procedure, setProcedure] = useState<string | null>(null);
  const [opMonth, setOpMonth] = useState<number | null>(null);
  const [opYear, setOpYear] = useState<number>(CURRENT_YEAR);
  const [rating, setRating] = useState<number>(0);
  const [ageRange, setAgeRange] = useState<string | null>(null);
  const [gender, setGender] = useState<string | null>(null);
  const [occupation, setOccupation] = useState<string | null>(null);
  const [diseases, setDiseases] = useState<string[]>([]);
  const [experience, setExperience] = useState('');
  const [shareQuote, setShareQuote] = useState(false);

  // Captcha
  const captchaNums = useMemo(() => {
    const a = Math.floor(Math.random() * 9) + 1;
    const b = Math.floor(Math.random() * 9) + 1;
    return { a, b };
  }, []);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaError, setCaptchaError] = useState(false);

  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const toggleDisease = useCallback((v: string) => {
    setDiseases((prev) => prev.includes(v) ? prev.filter((d) => d !== v) : [...prev, v]);
  }, []);

  const mutation = useMutation({
    mutationFn: submitPostop,
    onSuccess: () => setSubmitted(true),
    onError: () => setFormError(po.submitError),
  });

  const procedureOptions = [
    { value: 'ct', label: po.procedureCT },
    { value: 'tf', label: po.procedureTF },
    { value: 'both', label: po.procedureBoth },
  ];

  const monthOptions = months.map((m, i) => ({ value: String(i + 1), label: m }));
  const yearOptions = YEARS.map((y) => ({ value: String(y), label: String(y) }));

  const ageOptions = ['18-30', '31-45', '46-60', '61-75', '76+'].map((a) => ({
    value: a, label: `${a} ${po.ageSuffix}`,
  }));

  const genderOptions = [
    { value: 'male', label: po.genders.male },
    { value: 'female', label: po.genders.female },
    { value: 'divers', label: po.genders.divers },
  ];

  const occupationOptions = [
    { value: 'handworker', label: po.occupations.handworker },
    { value: 'office', label: po.occupations.office },
    { value: 'retired', label: po.occupations.retired },
  ];

  const diseaseOptions = [
    { value: 'diabetes', label: po.diseases.diabetes },
    { value: 'cholesterol', label: po.diseases.cholesterol },
    { value: 'bloodpressure', label: po.diseases.bloodpressure },
    { value: 'other_metabolic', label: po.diseases.other_metabolic },
  ];

  const handleSubmit = () => {
    setFormError(null);
    // Validate required
    if (!procedure || !opMonth || rating === 0) {
      setFormError(po.requiredFieldsError);
      return;
    }
    // Captcha
    const expected = captchaNums.a + captchaNums.b;
    if (parseInt(captchaAnswer, 10) !== expected) {
      setCaptchaError(true);
      return;
    }
    setCaptchaError(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const operationMonth = `${opYear}-${String(opMonth).padStart(2, '0')}`;
    mutation.mutate({
      procedure,
      operationMonth,
      rating,
      ageRange: ageRange ?? undefined,
      gender: gender ?? undefined,
      occupation: occupation ?? undefined,
      diseases: diseases.length > 0 ? diseases : undefined,
      experience: experience.trim() || undefined,
      shareQuote: experience.length >= 20 ? shareQuote : false,
    });
  };

  const stackScreen = (
    <Stack.Screen
      options={{
        title: t.nav.postop,
        headerRight: () => <LanguageToggle />,
      }}
    />
  );

  if (submitted) {
    return (
      <>
        {stackScreen}
        <View style={[styles.successContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.successIcon, { backgroundColor: `${colors.primary}15` }]}>
            <Feather name="check-circle" size={48} color={colors.primary} />
          </View>
          <Text style={[styles.successTitle, { color: colors.foreground }]}>{po.successTitle}</Text>
          <Text style={[styles.successMsg, { color: colors.mutedForeground }]}>{po.successMsg}</Text>
        </View>
      </>
    );
  }

  return (
    <>
      {stackScreen}
    <ScrollView
      style={[styles.scroll, { backgroundColor: colors.muted }]}
      contentContainerStyle={{ paddingBottom: bottomPad + 24 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={[styles.hero, { backgroundColor: colors.primary }]}>
        <Text style={[styles.heroTitle, { color: colors.primaryForeground }]}>{po.title}</Text>
        <Text style={[styles.heroDesc, { color: 'rgba(255,255,255,0.85)' }]}>{po.para}</Text>
      </View>

      <View style={styles.form}>
        {/* Required: Procedure */}
        <SelectRow
          label={`${po.procedureLabel} *`}
          value={procedure}
          options={procedureOptions}
          onSelect={setProcedure}
          colors={colors}
          placeholder={po.procedurePlaceholder}
        />

        {/* Required: Month */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{po.monthLabel} *</Text>
          <View style={styles.monthRow}>
            <View style={styles.monthDropdown}>
              <SelectRow
                label=""
                value={opMonth !== null ? String(opMonth) : null}
                options={monthOptions}
                onSelect={(v) => setOpMonth(v ? parseInt(v, 10) : null)}
                colors={colors}
                placeholder={po.monthPlaceholder}
              />
            </View>
            <View style={styles.yearDropdown}>
              <SelectRow
                label=""
                value={String(opYear)}
                options={yearOptions}
                onSelect={(v) => setOpYear(v ? parseInt(v, 10) : CURRENT_YEAR)}
                colors={colors}
                placeholder={po.yearPlaceholder}
              />
            </View>
          </View>
        </View>

        {/* Required: Rating */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{po.ratingLabel} *</Text>
          <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>{po.ratingHint}</Text>
          <StarRating value={rating} onChange={setRating} colors={colors} />
        </View>

        {/* Optional divider */}
        <View style={[styles.divider, { borderColor: colors.border }]}>
          <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>{po.optionalDivider}</Text>
        </View>

        {/* Age */}
        <SelectRow
          label={po.ageLabel}
          value={ageRange}
          options={ageOptions}
          onSelect={setAgeRange}
          colors={colors}
          placeholder={po.procedurePlaceholder}
        />

        {/* Gender */}
        <SelectRow
          label={po.genderLabel}
          value={gender}
          options={genderOptions}
          onSelect={setGender}
          colors={colors}
          placeholder={po.procedurePlaceholder}
        />

        {/* Occupation */}
        <SelectRow
          label={po.occupationLabel}
          value={occupation}
          options={occupationOptions}
          onSelect={setOccupation}
          colors={colors}
          placeholder={po.procedurePlaceholder}
        />

        {/* Diseases */}
        <MultiCheckbox
          label={po.diseasesLabel}
          options={diseaseOptions}
          selected={diseases}
          onToggle={toggleDisease}
          colors={colors}
        />

        {/* Experience */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
            {po.experienceLabel}{' '}
            <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>{po.optional}</Text>
          </Text>
          <TextInput
            style={[styles.textArea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            multiline
            numberOfLines={4}
            placeholder={po.experiencePlaceholder}
            placeholderTextColor={colors.mutedForeground}
            value={experience}
            onChangeText={setExperience}
            textAlignVertical="top"
          />
        </View>

        {/* Share quote consent (only if experience >= 20 chars) */}
        {experience.length >= 20 && (
          <Pressable
            style={styles.fieldGroup}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShareQuote(!shareQuote);
            }}
          >
            <View style={styles.checkRow}>
              <View style={[styles.checkbox, { borderColor: shareQuote ? colors.primary : colors.border, backgroundColor: shareQuote ? colors.primary : 'transparent' }]}>
                {shareQuote && <Feather name="check" size={12} color={colors.primaryForeground} />}
              </View>
              <Text style={[styles.checkLabel, { color: colors.foreground }]}>{po.shareQuoteLabel}</Text>
            </View>
          </Pressable>
        )}

        {/* Captcha */}
        <View style={[styles.captchaCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.captchaTitle, { color: colors.foreground }]}>{po.captchaTitle}</Text>
          <Text style={[styles.captchaQ, { color: colors.foreground }]}>
            {(po.captchaLabel as (a: number, b: number) => string)(captchaNums.a, captchaNums.b)}
          </Text>
          <TextInput
            style={[styles.captchaInput, { borderColor: captchaError ? colors.destructive : colors.border, backgroundColor: colors.muted, color: colors.foreground }]}
            keyboardType="number-pad"
            placeholder={po.captchaPlaceholder}
            placeholderTextColor={colors.mutedForeground}
            value={captchaAnswer}
            onChangeText={(v) => { setCaptchaAnswer(v); setCaptchaError(false); }}
            maxLength={3}
          />
          {captchaError && (
            <Text style={[styles.captchaError, { color: colors.destructive }]}>{po.captchaError}</Text>
          )}
        </View>

        {/* Privacy note */}
        <Text style={[styles.privacyNote, { color: colors.mutedForeground }]}>{po.privacyNote}</Text>

        {/* Error */}
        {formError && (
          <View style={[styles.errorRow, { backgroundColor: `${colors.destructive}15` }]}>
            <Feather name="alert-circle" size={14} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{formError}</Text>
          </View>
        )}

        {/* Submit */}
        <Pressable
          style={({ pressed }) => [
            styles.submitBtn,
            { backgroundColor: colors.primary, opacity: pressed || mutation.isPending ? 0.7 : 1 },
          ]}
          onPress={handleSubmit}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="send" size={16} color={colors.primaryForeground} />
              <Text style={[styles.submitText, { color: colors.primaryForeground }]}>{po.submit}</Text>
            </>
          )}
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
  heroTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', marginBottom: 10 },
  heroDesc: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  form: {
    padding: 16,
    gap: 20,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  fieldHint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectText: { fontSize: 14, fontFamily: 'Inter_400Regular', flex: 1 },
  dropdown: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 2,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  dropdownText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  monthRow: {
    flexDirection: 'row',
    gap: 10,
  },
  monthDropdown: { flex: 2 },
  yearDropdown: { flex: 1 },
  stars: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  starBtn: {
    padding: 2,
  },
  divider: {
    borderTopWidth: 1,
    paddingTop: 16,
    marginTop: 4,
  },
  dividerText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  checkboxGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  checkboxPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  checkboxText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  textArea: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    minHeight: 100,
    lineHeight: 22,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  checkLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  captchaCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  captchaTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  captchaQ: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  captchaInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    width: 100,
  },
  captchaError: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  privacyNote: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
    textAlign: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
  },
  errorText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 8,
    marginTop: 4,
  },
  submitText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 16,
  },
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  successMsg: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 24,
    textAlign: 'center',
  },
});
