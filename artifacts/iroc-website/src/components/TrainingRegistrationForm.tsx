/**
 * TrainingRegistrationForm — shared training sign-up form for all instruments.
 *
 * Features
 *  • Institution name → full address auto-fill (Nominatim via /api/lookup-institution, 800 ms debounce)
 *  • Postal code     → city / country auto-fill (/api/lookup-postal, 700 ms debounce)
 *  • CountrySelect   — searchable ISO alpha-2 combobox
 *  • HumanCheck captcha
 *
 * Props
 *  instrument  — API instrument key (TrainingRegistrationInputInstrument)
 *  dates       — pre-filtered active dates for this instrument
 */
import { useState, useEffect, useMemo } from 'react';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useRegisterForTraining, TrainingRegistrationInputInstrument } from '@workspace/api-client-react';
import type { TrainingDate } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useHumanCheck, HumanCheckWidget } from '@/components/HumanCheck';
import { useLanguage } from '@/contexts/LanguageContext';
import TrainingDateSelect from '@/components/TrainingDateSelect';
import { CountrySelect } from '@/components/CountrySelect';

// ── Form schema ───────────────────────────────────────────────────────────────
const schema = z.object({
  salutation:     z.enum(['Mann', 'Frau', 'Diverse', 'Andere']),
  medicalDegree:  z.enum(['Dr.', 'Dr. med.', 'Other']),
  firstName:      z.string().min(1, 'Required'),
  lastName:       z.string(),
  specialty:      z.string().min(1, 'Required'),
  institutionName:z.string().min(1, 'Required'),
  address:        z.string().min(1, 'Required'),
  street:         z.string().optional(),
  houseNumber:    z.string().optional(),
  postalCode:     z.string().min(1, 'Required'),
  city:           z.string().min(1, 'Required'),
  country:        z.string().min(1, 'Required'),
  phone:          z.string().min(1, 'Required'),
  fax:            z.string().optional(),
  email:          z.string().email('Invalid email'),
  websiteUrl:     z.string().optional(),
  trainingDateId: z.coerce.number().min(1, 'Please select a date'),
  notes:          z.string().optional(),
  privacyConsent: z.boolean().refine(v => v === true, 'You must accept the privacy policy'),
  marketingConsent: z.boolean().refine(
    v => v === true,
    'You must accept the doctor locator and media usage consent',
  ),
});

type FormData = z.infer<typeof schema>;

// ── Suggestion types ──────────────────────────────────────────────────────────
interface PostalSugg {
  city:        string;
  countryCode: string;
  postcode:    string;
}

interface InstitutionSugg {
  address:     string;
  postalCode:  string;
  city:        string;
  countryCode: string;
  displayName: string;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  instrument: TrainingRegistrationInputInstrument;
  dates:      TrainingDate[];
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TrainingRegistrationForm({ instrument, dates }: Props) {
  const { t } = useLanguage();
  const lang = t('de', 'en');
  const { toast }   = useToast();
  const captcha     = useHumanCheck();

  const localizedSchema = useMemo(() => schema.extend({
    firstName: z.string().min(1, t('Pflichtfeld', 'Required')),
    specialty: z.string().min(1, t('Pflichtfeld', 'Required')),
    institutionName: z.string().min(1, t('Pflichtfeld', 'Required')),
    address: z.string().min(1, t('Pflichtfeld', 'Required')),
    postalCode: z.string().min(1, t('Pflichtfeld', 'Required')),
    city: z.string().min(1, t('Pflichtfeld', 'Required')),
    country: z.string().min(1, t('Pflichtfeld', 'Required')),
    phone: z.string().min(1, t('Pflichtfeld', 'Required')),
    email: z.string().email(t('Ungültige E-Mail-Adresse', 'Invalid email address')),
    trainingDateId: z.coerce.number().min(1, t('Bitte wählen Sie einen Termin.', 'Please select a date.')),
    privacyConsent: z.boolean().refine(v => v === true, t('Bitte akzeptieren Sie die Datenschutzerklärung.', 'Please accept the privacy policy.')),
    marketingConsent: z.boolean().refine(v => v === true, t('Bitte akzeptieren Sie die Einwilligung für Arztsuche und Mediennutzung.', 'Please accept the doctor locator and media usage consent.')),
  }), [t]);

  const form = useForm<FormData>({
    resolver: zodResolver(localizedSchema),
    defaultValues: { privacyConsent: false, marketingConsent: false, country: 'DE' },
  });

  // ── Reactive field values for auto-fill effects ───────────────────────────
  const postalCodeVal      = useWatch({ control: form.control, name: 'postalCode' });
  const countryVal         = useWatch({ control: form.control, name: 'country' });
  const institutionNameVal = useWatch({ control: form.control, name: 'institutionName' });

  // ── Suggestion state ──────────────────────────────────────────────────────
  const [postalSugg, setPostalSugg]   = useState<PostalSugg | null>(null);
  const [postalDism, setPostalDism]   = useState(false);
  const [instSuggestions, setInstSuggestions] = useState<InstitutionSugg[]>([]);

  // ── Postal code → city / country (debounced 700 ms) ───────────────────────
  useEffect(() => {
    setPostalSugg(null); setPostalDism(false);
    const timer = setTimeout(async () => {
      if (!postalCodeVal || postalCodeVal.length < 4) return;
      const cc = countryVal?.length === 2 ? countryVal : 'DE';
      try {
        const res = await fetch(
          `/api/lookup-postal?postalCode=${encodeURIComponent(postalCodeVal)}&countryCode=${encodeURIComponent(cc)}`
        );
        if (!res.ok) return;
        const d = await res.json();
        if (d.city) setPostalSugg(d);
      } catch { /* silent */ }
    }, 700);
    return () => clearTimeout(timer);
  }, [postalCodeVal, countryVal]);

  // ── Institution name → address suggestions (debounced 800 ms) ──────────────
  useEffect(() => {
    setInstSuggestions([]);
    const timer = setTimeout(async () => {
      if (!institutionNameVal || institutionNameVal.length < 3) return;
      try {
        const cc = countryVal?.length === 2 ? countryVal : '';
        const res = await fetch(
          `/api/lookup-institution?name=${encodeURIComponent(institutionNameVal)}${cc ? `&countryCode=${encodeURIComponent(cc)}` : ''}`
        );
        if (!res.ok) return;
        const d = await res.json();
        if (Array.isArray(d)) setInstSuggestions(d.filter((r: InstitutionSugg) => r.city || r.postalCode));
      } catch { /* silent */ }
    }, 800);
    return () => clearTimeout(timer);
  }, [institutionNameVal]);

  // ── Apply helpers ─────────────────────────────────────────────────────────
  const applyPostal = () => {
    if (!postalSugg) return;
    if (postalSugg.city)        form.setValue('city',       postalSugg.city,        { shouldValidate: true });
    if (postalSugg.postcode)    form.setValue('postalCode', postalSugg.postcode,     { shouldValidate: true });
    if (postalSugg.countryCode) form.setValue('country',    postalSugg.countryCode,  { shouldValidate: true });
    setPostalSugg(null);
  };

  const applyInstitution = (s: InstitutionSugg) => {
    const name = s.displayName.split(',')[0].trim();
    if (name)          form.setValue('institutionName', name,         { shouldValidate: true });
    if (s.address)     form.setValue('address',         s.address,    { shouldValidate: true });
    if (s.postalCode)  form.setValue('postalCode',      s.postalCode, { shouldValidate: true });
    if (s.city)        form.setValue('city',            s.city,       { shouldValidate: true });
    if (s.countryCode) form.setValue('country',         s.countryCode,{ shouldValidate: true });
    setInstSuggestions([]);
  };

  // ── Mutation ──────────────────────────────────────────────────────────────
  const registerMut = useRegisterForTraining({
    mutation: {
      onSuccess: () => {
        toast({
          title: t('Erfolgreich', 'Success'),
          description: t(
            'Anmeldung erhalten. Bitte bestätigen Sie Ihre Anmeldung über den Link in Ihrer E-Mail.',
            'Registration received. Please confirm your registration using the link in your email.'
          ),
        });
        form.reset({ privacyConsent: false, marketingConsent: false, country: 'DE' });
        captcha.reset();
        setPostalSugg(null); setInstSuggestions([]);
      },
      onError: (err: unknown) => {
        const msg = String((err as { data?: { error?: string } })?.data?.error ?? '');
        toast({
          variant: 'destructive',
          title: t('Fehler', 'Error'),
          description: msg === 'EMAIL_SEND_FAILED'
            ? t(
                'Die Bestätigungs-E-Mail konnte nicht gesendet werden. Bitte versuchen Sie es später erneut oder kontaktieren Sie uns.',
                'The confirmation email could not be sent. Please try again later or contact us.'
              )
            : t('Fehler bei der Anmeldung.', 'Registration failed.'),
        });
      },
    },
  });

  const onSubmit = (data: FormData) => {
    if (!captcha.verified) return;
    registerMut.mutate({ data: { ...data, instrument } });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

      <div className="grid md:grid-cols-2 gap-6">

        {/* Salutation */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Anrede', 'Salutation')} *</label>
          <select {...form.register('salutation')}
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">{t('Bitte wählen', 'Please select')}</option>
            <option value="Mann">{t('Herr', 'Mr.')}</option>
            <option value="Frau">{t('Frau', 'Mrs.')}</option>
            <option value="Diverse">{t('Divers', 'Diverse')}</option>
            <option value="Andere">{t('Andere', 'Other')}</option>
          </select>
          {form.formState.errors.salutation && (
            <p className="text-destructive text-xs">{form.formState.errors.salutation.message}</p>
          )}
        </div>

        {/* Medical degree */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Titel', 'Title')} *</label>
          <select {...form.register('medicalDegree')}
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">{t('Bitte wählen', 'Please select')}</option>
            <option value="Dr.">Dr.</option>
            <option value="Dr. med.">Dr. med.</option>
            <option value="Other">{t('Keiner/Andere', 'None/Other')}</option>
          </select>
        </div>

        {/* First name */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Vorname', 'First Name')} *</label>
          <Input {...form.register('firstName')} />
          {form.formState.errors.firstName && (
            <p className="text-destructive text-xs">{form.formState.errors.firstName.message}</p>
          )}
        </div>

        {/* Last name */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Nachname', 'Last Name')}</label>
          <Input {...form.register('lastName')} />
        </div>

        {/* Specialty */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Fachgebiet', 'Specialty')} *</label>
          <Input {...form.register('specialty')} />
          {form.formState.errors.specialty && (
            <p className="text-destructive text-xs">{form.formState.errors.specialty.message}</p>
          )}
        </div>

        {/* Institution name — typeahead dropdown */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Arbeitsplatz', 'Workplace')} *</label>
          <div className="relative">
            <Input
              {...form.register('institutionName')}
              placeholder={t('z. B. Praxis Dr. Müller', 'e.g. Muster Medical Practice')}
              onBlur={() => setTimeout(() => setInstSuggestions([]), 150)}
            />
            {instSuggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-y-auto">
                {instSuggestions.map((s, i) => (
                  <li key={i}
                    className="px-3 py-2.5 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950 border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                    onMouseDown={(e) => { e.preventDefault(); applyInstitution(s); }}>
                    <div className="text-sm font-medium">{s.displayName.split(',')[0].trim()}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {[s.address, s.postalCode, s.city, s.countryCode].filter(Boolean).join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {form.formState.errors.institutionName && (
            <p className="text-destructive text-xs">{form.formState.errors.institutionName.message}</p>
          )}
        </div>

        {/* Street address */}
        <div className="md:col-span-2 space-y-2">
          <label className="text-sm font-medium">{t('Adresse', 'Address')} *</label>
          <Input {...form.register('address')} />
          {form.formState.errors.address && (
            <p className="text-destructive text-xs">{form.formState.errors.address.message}</p>
          )}
        </div>
        <div className="md:col-span-2 grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-muted-foreground">{t('Straße (für Versand)', 'Street (for shipping)')}</label>
            <Input {...form.register('street')} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('Hausnr.', 'No.')}</label>
            <Input {...form.register('houseNumber')} />
          </div>
        </div>

        {/* Postal code */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('PLZ', 'Postal Code')} *</label>
          <Input {...form.register('postalCode')} />
          {form.formState.errors.postalCode && (
            <p className="text-destructive text-xs">{form.formState.errors.postalCode.message}</p>
          )}
        </div>

        {/* City */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Stadt', 'City')} *</label>
          <Input {...form.register('city')} />
          {form.formState.errors.city && (
            <p className="text-destructive text-xs">{form.formState.errors.city.message}</p>
          )}
        </div>

        {/* Country — CountrySelect + postal suggestion banner */}
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="training-country">{t('Land', 'Country')} *</label>
          <Controller
            control={form.control}
            name="country"
            render={({ field }) => (
              <CountrySelect
                value={field.value ?? ''}
                onChange={field.onChange}
                lang={lang}
                inputId="training-country"
              />
            )}
          />
          {form.formState.errors.country && (
            <p className="text-destructive text-xs">{form.formState.errors.country.message}</p>
          )}
        </div>

        {/* Postal suggestion banner (appears next to country) */}
        {postalSugg && !postalDism && (
          <div className="space-y-2 flex items-end">
            <div className="flex items-center gap-2 text-xs bg-blue-50 border border-blue-200 rounded-md px-3 py-2 w-full">
              <span className="flex-1 text-blue-800">
                💡 {t('Vorschlag', 'Suggestion')}:{' '}
                <strong>{postalSugg.city}</strong>
                {postalSugg.countryCode && <>, <strong>{postalSugg.countryCode}</strong></>}
              </span>
              <button type="button"
                className="px-2 py-0.5 bg-blue-100 rounded text-blue-800 hover:bg-blue-200 font-medium whitespace-nowrap"
                onClick={applyPostal}>
                {t('Übernehmen', 'Apply')}
              </button>
              <button type="button"
                className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-blue-500"
                onClick={() => setPostalDism(true)}
                aria-label={t('Vorschlag schließen', 'Dismiss suggestion')}>
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Phone */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Telefon', 'Phone')} *</label>
          <Input {...form.register('phone')} />
          {form.formState.errors.phone && (
            <p className="text-destructive text-xs">{form.formState.errors.phone.message}</p>
          )}
        </div>

        {/* Email */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('E-Mail', 'Email')} *</label>
          <Input {...form.register('email')} type="email" />
          {form.formState.errors.email && (
            <p className="text-destructive text-xs">{form.formState.errors.email.message}</p>
          )}
        </div>

        {/* Fax */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Fax', 'Fax')}</label>
          <Input {...form.register('fax')} />
        </div>

        {/* Website */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Website', 'Website')}</label>
          <Input {...form.register('websiteUrl')} type="url" placeholder={t('https://praxis-mustermann.de', 'https://your-practice.example')} />
        </div>

      </div>

      {/* Training date */}
      <div className="space-y-2 pt-4 border-t">
        <label className="text-sm font-medium">{t('Schulungstermin', 'Training Date')} *</label>
        <TrainingDateSelect
          dates={dates}
          value={form.watch('trainingDateId') || ''}
          onChange={id => form.setValue('trainingDateId', id as number, { shouldValidate: true })}
          placeholder={t('Datum wählen', 'Select date')}
          error={form.formState.errors.trainingDateId?.message}
        />
        {form.formState.errors.trainingDateId && (
          <p className="text-destructive text-xs">{form.formState.errors.trainingDateId.message}</p>
        )}
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <label className="text-sm font-medium">{t('Anmerkungen', 'Notes')}</label>
        <Textarea {...form.register('notes')} />
      </div>

      {/* Privacy consent */}
      <div className="flex items-start gap-2 pt-4">
        <input type="checkbox" id="privacy-training" {...form.register('privacyConsent')} className="mt-1" />
        <label htmlFor="privacy-training" className="text-sm text-muted-foreground leading-snug">
          {t(
            'Ich stimme der Verarbeitung meiner Daten gemäß der Datenschutzerklärung zu.',
            'I agree to the processing of my data according to the privacy policy.'
          )} *
        </label>
      </div>
      {form.formState.errors.privacyConsent && (
        <p className="text-destructive text-xs">{form.formState.errors.privacyConsent.message}</p>
      )}

      {/* Doctor locator and media usage consent */}
      <div className="flex items-start gap-2 pt-2">
        <input
          type="checkbox"
          id="marketing-training"
          {...form.register('marketingConsent')}
          className="mt-1"
        />
        <label htmlFor="marketing-training" className="text-sm text-muted-foreground leading-snug">
          {t(
            'Ich erkläre mich damit einverstanden, dass meine Angaben auf der Arztsuchplattform von www.spirecut.de, www.spirecut.at und www.i-roc.de verwendet werden. Außerdem dürfen während der Schulung aufgezeichnete oder gesammelte Medien (z. B. Fotos und Videos) zu Werbe- und Marketingzwecken auf allen genannten Websites verwendet werden.',
            'I agree that my information may be used on the doctor locator platforms of www.spirecut.de, www.spirecut.at, and www.i-roc.de. I also agree that media recorded or collected during the training (such as photos and videos) may be used for promotional and marketing purposes on all websites named above.'
          )} *
        </label>
      </div>
      {form.formState.errors.marketingConsent && (
        <p className="text-destructive text-xs">{form.formState.errors.marketingConsent.message}</p>
      )}

      <HumanCheckWidget {...captcha} />

      <Button
        type="submit"
        size="lg"
        className="w-full mt-8"
        disabled={registerMut.isPending || !captcha.verified}
      >
        {registerMut.isPending
          ? t('Wird gesendet...', 'Sending...')
          : t('Anmeldung absenden', 'Submit Registration')}
      </Button>

    </form>
  );
}
