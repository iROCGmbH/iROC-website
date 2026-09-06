import { useState, useMemo } from 'react';
import { useWebsiteSettings } from '@/hooks/useWebsiteSettings';
import { useLanguage } from '@/contexts/LanguageContext';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useHumanCheck, HumanCheckWidget } from '@/components/HumanCheck';
import { MapPin, Phone, Mail, Clock, ExternalLink } from 'lucide-react';

// Static type — shape is language-independent
type FormData = {
  name: string;
  email: string;
  subject: string;
  message: string;
  privacyConsent: boolean;
};

// Schema factory — rebuilds when language changes so inline errors are bilingual
const makeSchema = (lang: string) => z.object({
  name:           z.string().min(1,  lang === 'DE' ? 'Pflichtfeld'                 : 'Required'),
  email:          z.string().email(  lang === 'DE' ? 'Ungültige E-Mail-Adresse'    : 'Invalid email'),
  subject:        z.string().min(1,  lang === 'DE' ? 'Pflichtfeld'                 : 'Required'),
  message:        z.string().min(10, lang === 'DE' ? 'Mindestens 10 Zeichen'       : 'Min 10 characters'),
  privacyConsent: z.boolean().refine((v) => v === true, lang === 'DE' ? 'Pflichtfeld' : 'Required'),
});

export default function Contact() {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const captcha = useHumanCheck();
  const [isPending, setIsPending] = useState(false);
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';
  const ws = useWebsiteSettings();

  // Rebuild schema when language switches so validation messages follow the UI language
  const schema = useMemo(() => makeSchema(language), [language]);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { privacyConsent: false },
  });

  const onSubmit = async (data: FormData) => {
    if (!captcha.verified) return;
    setIsPending(true);
    try {
      const res = await fetch(`${BASE}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed');
      toast({
        title: t('Nachricht gesendet', 'Message sent'),
        description: t(
          'Vielen Dank! Wir werden uns so schnell wie möglich bei Ihnen melden.',
          'Thank you! We will get back to you as soon as possible.'
        ),
      });
      form.reset({ privacyConsent: false });
      captcha.reset();
    } catch {
      toast({
        variant: 'destructive',
        title: t('Fehler', 'Error'),
        description: t('Fehler beim Senden. Bitte versuchen Sie es erneut.', 'Failed to send. Please try again.'),
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="py-20 bg-muted/10 min-h-screen">
      <div className="container mx-auto px-4 max-w-6xl">

        {/* Header */}
        <div className="text-center mb-14">
          <span className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-semibold px-4 py-1.5 rounded-full mb-4">
            <Mail className="w-3.5 h-3.5" />
            {t('Kontakt', 'Contact')}
          </span>
          <h1 className="text-4xl font-bold mb-4">{t('Nehmen Sie Kontakt auf', 'Get in touch')}</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            {t(
              'Wir freuen uns auf Ihre Anfrage. Unser Team steht Ihnen gerne zur Verfügung.',
              'We look forward to your enquiry. Our team is happy to assist you.'
            )}
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-10">

          {/* ── Left column: company info ── */}
          <div className="lg:col-span-2 space-y-6">

            <div className="bg-white rounded-2xl border shadow-sm p-6 space-y-5">
              <h2 className="text-lg font-bold text-slate-800">iROC GmbH</h2>

              <div className="flex gap-3">
                <div className="p-2 bg-primary/10 rounded-lg shrink-0 h-fit">
                  <MapPin className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700 mb-0.5">{t('Adresse', 'Address')}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {ws.ws_address_street}<br />
                    {ws.ws_address_postal} {ws.ws_address_city}<br />
                    {t(ws.ws_address_country_de, ws.ws_address_country_en)}
                  </p>
                  <a
                    href={ws.ws_maps_directions_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1.5"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {t('Auf Google Maps öffnen', 'Open in Google Maps')}
                  </a>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="p-2 bg-primary/10 rounded-lg shrink-0 h-fit">
                  <Phone className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700 mb-0.5">{t('Telefon / Fax', 'Phone / Fax')}</p>
                  <a href={`tel:${ws.ws_contact_phone.replace(/\s/g,'')}`} className="text-sm text-muted-foreground hover:text-primary transition-colors block">
                    T {ws.ws_contact_phone}
                  </a>
                  {ws.ws_contact_fax && (
                    <span className="text-sm text-muted-foreground block">F {ws.ws_contact_fax}</span>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <div className="p-2 bg-primary/10 rounded-lg shrink-0 h-fit">
                  <Mail className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700 mb-0.5">{t('E-Mail', 'Email')}</p>
                  <a href={`mailto:${ws.ws_contact_email}`} className="text-sm text-muted-foreground hover:text-primary transition-colors">
                    {ws.ws_contact_email}
                  </a>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="p-2 bg-primary/10 rounded-lg shrink-0 h-fit">
                  <Clock className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700 mb-1">{t('Geschäftszeiten', 'Business hours')}</p>
                  <div className="text-sm text-muted-foreground space-y-0.5">
                    <p>{t('Mo – Fr:', 'Mon – Fri:')} 09:00 – 17:00</p>
                    <p>{t('Sa – So:', 'Sat – Sun:')} {t('Geschlossen', 'Closed')}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Map embed */}
            <div className="rounded-2xl overflow-hidden border shadow-sm h-52">
              <iframe
                src={ws.ws_maps_embed_url}
                width="100%"
                height="100%"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title={t('Standort der iROC GmbH', 'iROC GmbH location')}
              />
            </div>
          </div>

          {/* ── Right column: form ── */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-2xl border shadow-sm p-8">
              <h2 className="text-xl font-bold mb-6">{t('Nachricht senden', 'Send a message')}</h2>

              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

                <div className="grid md:grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{t('Ihr Name', 'Your name')} *</label>
                    <Input {...form.register('name')} placeholder={t('Dr. Max Mustermann', 'Dr. Jane Smith')} />
                    {form.formState.errors.name && (
                      <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{t('E-Mail-Adresse', 'Email address')} *</label>
                    <Input {...form.register('email')} type="email" placeholder="ihre@email.de" />
                    {form.formState.errors.email && (
                      <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t('Betreff', 'Subject')} *</label>
                  <Input
                    {...form.register('subject')}
                    placeholder={t('Worum geht es?', 'What is your enquiry about?')}
                  />
                  {form.formState.errors.subject && (
                    <p className="text-xs text-destructive">{form.formState.errors.subject.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t('Ihre Nachricht', 'Your message')} *</label>
                  <textarea
                    {...form.register('message')}
                    rows={6}
                    placeholder={t(
                      'Bitte beschreiben Sie Ihr Anliegen so detailliert wie möglich...',
                      'Please describe your enquiry in as much detail as possible...'
                    )}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {form.formState.errors.message && (
                    <p className="text-xs text-destructive">{form.formState.errors.message.message}</p>
                  )}
                </div>

                <div className="flex items-start gap-2 pt-2 border-t">
                  <input
                    type="checkbox"
                    id="contact-privacy"
                    {...form.register('privacyConsent')}
                    className="mt-1"
                  />
                  <label htmlFor="contact-privacy" className="text-sm text-muted-foreground leading-snug">
                    {t(
                      'Ich stimme der Verarbeitung meiner Daten gemäß der Datenschutzerklärung zu.',
                      'I agree to the processing of my data according to the privacy policy.'
                    )} *
                  </label>
                </div>
                {form.formState.errors.privacyConsent && (
                  <p className="text-xs text-destructive">{form.formState.errors.privacyConsent.message}</p>
                )}

                <HumanCheckWidget {...captcha} />

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={isPending || !captcha.verified}
                >
                  {isPending
                    ? t('Wird gesendet…', 'Sending…')
                    : t('Nachricht senden', 'Send message')}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
