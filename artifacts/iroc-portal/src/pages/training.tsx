import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { getListPortalTrainingDatesQueryKey, useListPortalTrainingDates, usePortalTrainingRequest } from '@workspace/api-client-react';
import type { PortalTrainingDate } from '@workspace/api-client-react';
import { Layout } from '@/components/layout';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/lib/auth';
import { CountrySelect } from '@/components/CountrySelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { filterAvailableTrainingDates } from '@/lib/training-availability';
import { AlertCircle, Calendar, CheckCircle2, ChevronRight, Loader2, MapPin, Users } from 'lucide-react';

const schema = z.object({
  trainingDateId: z.number().optional(),
  salutation: z.string().min(1, 'Required'),
  medicalDegree: z.string().min(1, 'Required'),
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().optional(),
  specialty: z.string().min(1, 'Required'),
  institutionName: z.string().min(1, 'Required'),
  address: z.string().min(1, 'Required'),
  postalCode: z.string().min(1, 'Required'),
  city: z.string().min(1, 'Required'),
  country: z.string().min(1, 'Required'),
  phone: z.string().min(1, 'Required'),
  fax: z.string().optional(),
  email: z.string().email('Invalid email'),
  websiteUrl: z.string().optional(),
  requestedDate: z.string().min(1, 'Required'),
  location: z.string().optional(),
  participantCount: z.coerce.number().optional(),
  notes: z.string().optional(),
  privacyConsent: z.boolean().refine(value => value === true, 'Required'),
  marketingConsent: z.boolean().refine(value => value === true, 'Required'),
});

type FormData = z.infer<typeof schema>;
interface PostalSugg { city: string; countryCode: string; postcode: string }

const products = [
  { key: 'spirecut', de: 'Spirecut', en: 'Spirecut' },
  { key: 'ministem', de: 'MiniStem / SVF', en: 'MiniStem / SVF' },
] as const;

function formatDate(value: string, lang: string) {
  try {
    return new Date(`${value}T12:00:00`).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return value; }
}

function Availability({ date, t }: { date: PortalTrainingDate; t: (de: string, en: string) => string }) {
  if (!date.isAvailable) return <span className="rounded-md bg-red-100 px-2 py-1 text-[10px] font-bold uppercase text-red-700">{t('Ausgebucht', 'Full')}</span>;
  const lowAvailability = date.availableSpots / Math.max(1, date.maxParticipants) < 0.3;
  return (
    <span className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase ${lowAvailability ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
      {lowAvailability
        ? t(`Noch ${date.availableSpots} Plätze`, `${date.availableSpots} spots left`)
        : t(`${date.availableSpots} Plätze verfügbar`, `${date.availableSpots} spots available`)}
    </span>
  );
}

export default function Training() {
  const { t, language } = useLanguage();
  const lang = language === 'DE' ? 'de' : 'en';
  const { customer } = useAuth();
  const { toast } = useToast();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [selectedDateId, setSelectedDateId] = useState<number | null>(null);
  const [postalSugg, setPostalSugg] = useState<PostalSugg | null>(null);
  const [postalDismissed, setPostalDismissed] = useState(false);
  const [selectedInstrument, setSelectedInstrument] = useState(() => {
    if (customer?.instrument === 'ministem' || customer?.instrument === 'svf') return 'ministem';
    return 'spirecut';
  });
  const { data: trainingDates, isLoading: datesLoading } = useListPortalTrainingDates({
    query: { enabled: !!customer, queryKey: getListPortalTrainingDatesQueryKey() },
  });
  // The API only returns actionable dates today, but keep the UI defensive:
  // an unavailable date must never appear in the list of available occasions.
  const dates = useMemo(
    () => filterAvailableTrainingDates((trainingDates as PortalTrainingDate[] | undefined) ?? []),
    [trainingDates],
  );
  const datesForInstrument = dates.filter(date => date.instrument === selectedInstrument);
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      privacyConsent: false, marketingConsent: false, country: 'DE',
      email: customer?.email ?? '', firstName: customer?.firstName ?? '', lastName: customer?.lastName ?? '',
    },
  });
  const errors = form.formState.errors;
  const postalCode = form.watch('postalCode');
  const country = form.watch('country');

  useEffect(() => {
    setPostalSugg(null);
    setPostalDismissed(false);
    const timer = setTimeout(async () => {
      if (!postalCode || postalCode.length < 4) return;
      try {
        const response = await fetch(`/api/lookup-postal?postalCode=${encodeURIComponent(postalCode)}&countryCode=${encodeURIComponent(country?.length === 2 ? country : 'DE')}`);
        if (!response.ok) return;
        const suggestion = await response.json();
        if (suggestion.city) setPostalSugg(suggestion);
      } catch { /* Postal lookup is an optional convenience. */ }
    }, 700);
    return () => clearTimeout(timer);
  }, [postalCode, country]);

  const selectDate = (date: PortalTrainingDate) => {
    if (!date.isAvailable) return;
    setSelectedDateId(date.id);
    form.setValue('trainingDateId', date.id);
    form.setValue('requestedDate', date.date, { shouldValidate: true });
  };
  const clearDate = useCallback(() => {
    setSelectedDateId(null);
    form.setValue('trainingDateId', undefined);
    form.setValue('requestedDate', '');
  }, [form]);

  useEffect(() => {
    if (selectedDateId !== null && !dates.some(date => date.id === selectedDateId)) {
      clearDate();
    }
  }, [dates, selectedDateId, clearDate]);

  const mutation = usePortalTrainingRequest({
    mutation: {
      onSuccess: () => {
        setIsSubmitted(true);
        toast({
          title: t('Anmeldung eingegangen', 'Registration received'),
          description: t('Ihre Trainingsanfrage wurde übermittelt. Wir melden uns zeitnah.', 'Your training request has been submitted. We will be in touch shortly.'),
        });
      },
      onError: error => toast({ variant: 'destructive', title: t('Fehler', 'Error'), description: error.message || t('Anfrage fehlgeschlagen.', 'Request failed.') }),
    },
  });
  const submit = (data: FormData) => mutation.mutate({
    data: { ...data, participantCount: data.participantCount || undefined } as Parameters<typeof mutation.mutate>[0]['data'],
  });
  const field = (label: string, name: keyof FormData, type = 'text', placeholder = '') => (
    <div className="space-y-1.5">
      <label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</label>
      <Input {...form.register(name)} type={type} placeholder={placeholder} className="h-12 rounded-2xl border-transparent bg-slate-50 font-medium focus-visible:border-violet-500 focus-visible:bg-white" />
      {errors[name] && <p className="ml-1 text-[10px] font-bold uppercase text-red-500">{t('Erforderlich', 'Required')}</p>}
    </div>
  );

  if (isSubmitted) return (
    <Layout title={t('Schulung', 'Training')}>
      <div className="flex flex-col items-center justify-center pb-12 pt-16 text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-violet-100 text-violet-600 shadow-sm"><CheckCircle2 className="h-10 w-10" /></div>
        <h3 className="mb-3 text-3xl font-extrabold tracking-tight text-slate-900">{t('Eingegangen', 'Received')}</h3>
        <p className="mb-10 max-w-[280px] font-medium text-slate-500">{t('Wir prüfen die Verfügbarkeit und melden uns zeitnah bei Ihnen.', 'We will review availability and contact you shortly.')}</p>
        <Button onClick={() => { setIsSubmitted(false); clearDate(); form.reset({ privacyConsent: false, marketingConsent: false, country: 'DE', email: customer?.email ?? '', firstName: customer?.firstName ?? '', lastName: customer?.lastName ?? '' }); }} className="h-14 rounded-2xl bg-violet-600 px-8 text-base font-bold hover:bg-violet-700">{t('Weitere Anmeldung', 'New Registration')}</Button>
      </div>
    </Layout>
  );

  return (
    <Layout title={t('Schulung', 'Training')}>
      <div className="mb-6"><h2 className="text-3xl font-extrabold tracking-tight text-slate-900">{t('Schulung', 'Training')}</h2><p className="mt-1 font-medium text-slate-500">{t('Für anstehende Termine anmelden.', 'Register for upcoming sessions.')}</p></div>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-6 pb-8">
        <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-violet-50/50 px-5 py-4 font-extrabold text-slate-800"><Calendar className="h-5 w-5 text-violet-600" />{t('Termin wählen', 'Choose Date')}</div>
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap gap-2">{products.map(product => <button key={product.key} type="button" onClick={() => { setSelectedInstrument(product.key); clearDate(); }} className={`rounded-full border px-4 py-2 text-sm font-bold transition-colors ${selectedInstrument === product.key ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-200 text-slate-600'}`}>{lang === 'de' ? product.de : product.en}</button>)}</div>
            {datesLoading ? <div className="flex justify-center py-6 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div> : datesForInstrument.length === 0 ? <div className="rounded-2xl bg-amber-50 p-4 text-amber-800"><AlertCircle className="mb-2 h-5 w-5" /><p className="font-bold">{t('Keine Termine verfügbar', 'No dates available')}</p><p className="text-sm">{t('Bitte geben Sie unten einen Wunschtermin ein.', 'Please enter a preferred date below.')}</p></div> : <div className="space-y-3">{datesForInstrument.map(date => <button key={date.id} type="button" disabled={!date.isAvailable} onClick={() => selectDate(date)} className={`w-full rounded-2xl border-2 p-4 text-left ${selectedDateId === date.id ? 'border-violet-600 bg-violet-50/50' : 'border-slate-100'} ${!date.isAvailable ? 'cursor-not-allowed opacity-50' : ''}`}><div className="mb-2 flex items-start justify-between gap-3"><strong className="text-lg text-slate-900">{formatDate(date.date, lang)}</strong><Availability date={date} t={t} /></div><p className="flex items-center gap-1 text-sm font-medium text-slate-600"><MapPin className="h-3.5 w-3.5" />{date.location}{date.locationDetail ? ` · ${date.locationDetail}` : ''}</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Users className="h-3.5 w-3.5" />{date.registeredCount}/{date.maxParticipants} {t('Teilnehmer', 'participants')}{date.time ? ` · ${date.time}` : ''}</p>{date.notes && <p className="mt-1 text-xs text-slate-500">{date.notes}</p>}</button>)}</div>}
            {!selectedDateId && <div className="space-y-1.5 border-t border-slate-100 pt-4"><label className="ml-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('Oder Wunschtermin', 'Or Preferred Date')}</label><Input {...form.register('requestedDate')} type="date" min={new Date().toISOString().split('T')[0]} className="h-12 rounded-2xl border-transparent bg-slate-50" />{errors.requestedDate && <p className="text-xs text-red-500">{t('Erforderlich', 'Required')}</p>}</div>}
            {selectedDateId && <button type="button" onClick={clearDate} className="text-sm font-bold text-violet-600">{t('Termin ändern', 'Change date')}</button>}
          </div>
        </section>
        <section className="space-y-4 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <h3 className="font-extrabold text-slate-900">{t('Details', 'Details')}</h3>
          <div className="grid grid-cols-2 gap-4"><div className="space-y-1.5"><label className="ml-1 text-[11px] font-bold uppercase text-slate-500">{t('Anrede', 'Salutation')}</label><select {...form.register('salutation')} className="h-12 w-full rounded-2xl border-0 bg-slate-50 px-3 font-medium"><option value="">{t('Bitte wählen', 'Please select')}</option><option value="Mann">{t('Herr', 'Mr.')}</option><option value="Frau">{t('Frau', 'Mrs.')}</option><option value="Diverse">{t('Divers', 'Diverse')}</option><option value="Andere">{t('Andere', 'Other')}</option></select></div><div className="space-y-1.5"><label className="ml-1 text-[11px] font-bold uppercase text-slate-500">{t('Titel', 'Title')}</label><select {...form.register('medicalDegree')} className="h-12 w-full rounded-2xl border-0 bg-slate-50 px-3 font-medium"><option value="">{t('Bitte wählen', 'Please select')}</option><option value="Dr.">Dr.</option><option value="Dr. med.">Dr. med.</option><option value="Other">{t('Keiner/Andere', 'None/Other')}</option></select></div></div>
          <div className="grid grid-cols-2 gap-4">{field(t('Vorname', 'First Name'), 'firstName')}{field(t('Nachname', 'Last Name'), 'lastName')}</div>
          {field(t('Fachgebiet', 'Specialty'), 'specialty')}{field(t('Praxis / Klinik', 'Clinic'), 'institutionName')}
          {field(t('Straße und Hausnummer', 'Street and Number'), 'address')}
          <div className="grid grid-cols-2 gap-4">{field(t('PLZ', 'Zip'), 'postalCode')}{field(t('Stadt', 'City'), 'city')}</div>
          {postalSugg && !postalDismissed && <div className="flex items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800"><span className="flex-1">💡 {t('Vorschlag', 'Suggestion')}: <strong>{postalSugg.city}, {postalSugg.countryCode}</strong></span><button type="button" onClick={() => { form.setValue('city', postalSugg.city, { shouldValidate: true }); form.setValue('postalCode', postalSugg.postcode, { shouldValidate: true }); form.setValue('country', postalSugg.countryCode, { shouldValidate: true }); setPostalSugg(null); }} className="font-bold">{t('Übernehmen', 'Apply')}</button><button type="button" aria-label={t('Schließen', 'Dismiss')} onClick={() => setPostalDismissed(true)}>×</button></div>}
          <div className="space-y-1.5"><label className="ml-1 text-[11px] font-bold uppercase text-slate-500">{t('Land', 'Country')}</label><Controller control={form.control} name="country" render={({ field: countryField }) => <CountrySelect value={countryField.value ?? ''} onChange={countryField.onChange} lang={lang} />} /></div>
          <div className="grid grid-cols-2 gap-4">{field(t('Telefon', 'Phone'), 'phone', 'tel')}{field(t('E-Mail', 'Email'), 'email', 'email')}</div>
          <div className="grid grid-cols-2 gap-4">{field(t('Fax', 'Fax'), 'fax')}{field(t('Website', 'Website'), 'websiteUrl', 'url')}</div>
          <div className="grid grid-cols-2 gap-4">{field(t('Teilnehmerzahl', 'Participants'), 'participantCount', 'number')}{field(t('Schulungsort', 'Location preference'), 'location')}</div>
          <div className="space-y-1.5"><label className="ml-1 text-[11px] font-bold uppercase text-slate-500">{t('Anmerkungen', 'Notes')}</label><Textarea {...form.register('notes')} className="min-h-24 rounded-2xl border-transparent bg-slate-50" /></div>
        </section>
        <div className="space-y-3 px-1">{[['privacyConsent', t('Ich stimme der Datenverarbeitung gemäß Datenschutzerklärung zu.', 'I agree to the data processing policy.')], ['marketingConsent', t('Ich stimme der Nutzung meiner Daten und Medien zu.', 'I agree to the use of my data and media.')]].map(([name, label]) => <label key={name} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><input type="checkbox" {...form.register(name as 'privacyConsent' | 'marketingConsent')} className="mt-0.5 h-5 w-5 rounded text-violet-600" /><span className="text-xs font-medium leading-snug text-slate-600">{label} *</span></label>)}</div>
        <Button type="submit" disabled={mutation.isPending} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 text-base font-bold shadow-lg shadow-violet-600/20 hover:bg-violet-700">{mutation.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <>{t('Verbindlich Anmelden', 'Submit Registration')}<ChevronRight className="h-5 w-5" /></>}</Button>
      </form>
    </Layout>
  );
}