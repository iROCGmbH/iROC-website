import { useState, useEffect, type ChangeEvent, type FormEvent, type HTMLInputTypeAttribute } from 'react';
import { useAuth } from '@/lib/auth';
import { getPortalMeQueryKey, usePortalMe, usePortalProfileUpdateRequest } from '@workspace/api-client-react';
import { Layout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, User, Mail, Phone, MapPin, Building2, CheckCircle2, AlertCircle, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export default function Profile() {
  const { customer, login, token } = useAuth();
  const { t } = useLanguage();
  const { data: profile, isLoading } = usePortalMe({
    query: { enabled: !!token, queryKey: getPortalMeQueryKey() }
  });

  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    postalCode: '',
    city: '',
    country: '',
    institutionName: '',
    notes: ''
  });
  type FormField = keyof typeof formData;

  useEffect(() => {
    if (profile) {
      if (token) login(token, profile);
      setFormData({
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        email: profile.email || '',
        phone: profile.phone || '',
        address: profile.address || '',
        postalCode: profile.postalCode || '',
        city: profile.city || '',
        country: profile.country || '',
        institutionName: profile.institutionName || '',
        notes: ''
      });
    }
  }, [profile, token, login]);

  const updateMutation = usePortalProfileUpdateRequest({
    mutation: {
      onSuccess: () => {
        toast({
          title: t('Anfrage gesendet', 'Update Requested'),
          description: t('Ihre Anfrage wird geprüft.', 'Your request is being reviewed.'),
        });
        setFormData(prev => ({ ...prev, notes: '' }));
      },
      onError: () => {
        toast({
          title: t('Fehler', 'Error'),
          description: t('Anfrage fehlgeschlagen.', 'Request failed.'),
          variant: 'destructive',
        });
      }
    }
  });

  const handleChange = (field: FormField) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const updates: Record<string, string> = {};
    Object.keys(formData).forEach(key => {
      const k = key as keyof typeof formData;
      if (k === 'notes') {
        if (formData.notes) updates.notes = formData.notes;
      } else if (profile && formData[k] !== profile[k as keyof typeof profile]) {
        updates[k] = formData[k];
      }
    });

    if (Object.keys(updates).length === 0) return;
    updateMutation.mutate({ data: updates });
  };

  const user = profile || customer;
  const name = [user?.title, user?.firstName, user?.lastName].filter(Boolean).join(' ');

  if (isLoading) {
    return (
      <Layout title={t('Profil', 'Profile')}>
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-3xl" />
          <Skeleton className="h-64 rounded-3xl" />
        </div>
      </Layout>
    );
  }

  const InputRow = ({
    id,
    label,
    icon: Icon,
    type = 'text',
  }: {
    id: FormField;
    label: string;
    icon: LucideIcon;
    type?: HTMLInputTypeAttribute;
  }) => (
    <div className="flex flex-col gap-1.5 py-3 border-b border-slate-100 last:border-0">
      <label htmlFor={id} className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" /> {label}
      </label>
      <Input
        id={id}
        type={type}
        value={formData[id]}
        onChange={handleChange(id)}
        className="h-10 px-0 bg-transparent border-none shadow-none text-base font-bold text-slate-900 focus-visible:ring-0 p-0 rounded-none placeholder:font-medium placeholder:text-slate-300"
      />
    </div>
  );

  return (
    <Layout title={t('Profil', 'Profile')}>
      <div className="mb-6">
        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">{t('Profil', 'Profile')}</h2>
        <p className="text-slate-500 mt-1 font-medium">
          {t('Persönliche Daten & Einstellungen', 'Personal details & settings')}
        </p>
      </div>

      <div className="space-y-6 pb-8">
        {/* Identity Card */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-6 text-white shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
          <div className="flex items-center gap-5 relative z-10">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center shrink-0 border border-white/10 shadow-inner">
              <User className="w-8 h-8 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold tracking-tight mb-1">{name}</h3>
              <div className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/15 text-white/90 text-[10px] font-bold uppercase tracking-wider">
                ID: {user?.customerNr}
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex gap-3 text-blue-900">
            <AlertCircle className="w-5 h-5 shrink-0 text-blue-500 mt-0.5" />
            <p className="text-sm font-medium leading-relaxed">
              {t('Änderungen werden zur Sicherheit von uns geprüft, bevor sie im Profil sichtbar sind.', 'For security, updates are reviewed before they appear on your profile.')}
            </p>
          </div>

          <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
            <InputRow id="firstName" label={t('Vorname', 'First Name')} icon={User} />
            <InputRow id="lastName" label={t('Nachname', 'Last Name')} icon={User} />
            <InputRow id="email" label="E-Mail" icon={Mail} type="email" />
            <InputRow id="phone" label={t('Telefon', 'Phone')} icon={Phone} type="tel" />
            <InputRow id="institutionName" label={t('Klinik/Praxis', 'Clinic')} icon={Building2} />
          </div>

          <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
            <InputRow id="address" label={t('Straße', 'Street')} icon={MapPin} />
            <div className="grid grid-cols-2 gap-4">
              <InputRow id="postalCode" label={t('PLZ', 'Zip')} icon={MapPin} />
              <InputRow id="city" label={t('Stadt', 'City')} icon={MapPin} />
            </div>
            <InputRow id="country" label={t('Land', 'Country')} icon={MapPin} />
          </div>

          <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
            <label htmlFor="notes" className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> {t('Anmerkungen', 'Notes')}
            </label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={handleChange('notes')}
              className="mt-2 min-h-[100px] bg-transparent border-slate-100 shadow-none text-base font-medium text-slate-900 placeholder:text-slate-300"
              placeholder={t('Teilen Sie uns weitere Änderungswünsche mit.', 'Share any additional requested changes.')}
            />
          </div>

          <Button
            type="submit"
            className="w-full h-14 rounded-2xl text-base font-bold shadow-md hover:shadow-lg transition-all"
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <CheckCircle2 className="w-5 h-5 mr-2" />}
            {t('Änderungen anfragen', 'Request Updates')}
          </Button>
        </form>
      </div>
    </Layout>
  );
}
