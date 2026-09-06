import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { usePortalLogin } from '@workspace/api-client-react';
const irocLogoFallback = `${import.meta.env.BASE_URL}iroc-new-logo.svg`;
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Globe, ArrowRight, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const [customerNr, setCustomerNr] = useState('');
  const [reorderCode, setReorderCode] = useState('');
  const [showReorderCode, setShowReorderCode] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();
  const { language, toggleLanguage, t } = useLanguage();

  const loginMutation = usePortalLogin({
    mutation: {
      onSuccess: (data) => {
        login(data.token, data.customer);
      },
      onError: (err: unknown) => {
        // 403 PORTAL_NOT_CERTIFIED: customer exists but is not a certified iROC doctor
        const status = (err as { status?: number })?.status;
        const errCode = (err as { data?: { error?: string } })?.data?.error;
        const isNotCertified = status === 403 || errCode === 'PORTAL_NOT_CERTIFIED';
        toast({
          title: t('Anmeldung fehlgeschlagen', 'Login Failed'),
          description: isNotCertified
            ? t(
                'Die iROC app ist ausschließlich für zertifizierte iROC-Ärzte zugänglich. Wenn Sie ein Institut sind, das für einen Arzt bestellt, verwenden Sie bitte das öffentliche Bestellformular. Bei Fragen wenden Sie sich bitte an iROC GmbH.',
                'The iROC app is exclusively for certified iROC doctors. If you are an institute ordering on behalf of a doctor, please use the public order form. For questions, please contact iROC GmbH.'
              )
            : t('Ungültige Zugangsdaten. Bitte versuchen Sie es erneut.', 'Invalid credentials. Please try again.'),
          variant: 'destructive',
        });
      },
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerNr || !reorderCode) return;
    loginMutation.mutate({ data: { customerNr, reorderCode } });
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-slate-50">
      {/* Top utility bar */}
      <div className="p-4 flex justify-end" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}>
        <button
          onClick={toggleLanguage}
          className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 hover:text-slate-900 transition-colors bg-white border border-slate-200/60 rounded-full px-4 py-2 shadow-sm"
        >
          <Globe className="w-4 h-4" />
          {language === 'DE' ? 'EN' : 'DE'}
        </button>
      </div>

      <div className="flex-1 flex flex-col justify-center px-6 max-w-sm mx-auto w-full pb-12">
        {/* Branding */}
        <div className="flex flex-col items-center mb-10 text-center">
          <img
            src={irocLogoFallback}
            alt="iROC GmbH — Innovative & Regenerative medical Oriented Consultation"
            className="h-auto w-full max-w-[340px] object-contain"
          />
          <h1 className="mt-8 text-2xl font-bold text-slate-900 tracking-tight">
            {t('iROC app', 'iROC app')}
          </h1>
          <p className="text-slate-500 mt-2 text-sm leading-relaxed">
            {t('Melden Sie sich mit Ihrer Kundennummer und Ihrem Zugangscode an.', 'Sign in with your customer number and access code.')}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="customerNr" className="text-xs font-bold uppercase tracking-wide text-slate-500 ml-1">
              {t('Kundennummer', 'Customer Number')}
            </label>
            <Input
              id="customerNr"
              placeholder={t('z. B. DOC10025', 'e.g. DOC10025')}
              value={customerNr}
              onChange={(e) => setCustomerNr(e.target.value)}
              className="bg-white h-14 rounded-2xl text-base px-4 border-slate-200 shadow-sm focus-visible:ring-primary focus-visible:border-primary placeholder:text-slate-400"
              autoComplete="username"
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="reorderCode" className="text-xs font-bold uppercase tracking-wide text-slate-500 ml-1">
              {t('Zugangscode', 'Access Code')}
            </label>
            <div className="relative">
              <Input
                id="reorderCode"
                type={showReorderCode ? 'text' : 'password'}
                placeholder={t('z. B. M3D9X7P8', 'e.g. M3D9X7P8')}
                value={reorderCode}
                onChange={(e) => setReorderCode(e.target.value)}
                className="bg-white h-14 rounded-2xl text-base px-4 pr-14 border-slate-200 shadow-sm focus-visible:ring-primary focus-visible:border-primary placeholder:text-slate-400 tracking-widest"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowReorderCode((visible) => !visible)}
                aria-label={showReorderCode ? t('Zugangscode ausblenden', 'Hide access code') : t('Zugangscode anzeigen', 'Show access code')}
                aria-pressed={showReorderCode}
                className="absolute right-1 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {showReorderCode ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-14 rounded-2xl text-base font-bold shadow-md hover:shadow-lg transition-all mt-4 flex items-center justify-center gap-2"
            disabled={loginMutation.isPending || !customerNr || !reorderCode}
          >
            {loginMutation.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                {t('Anmelden', 'Sign In')}
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </Button>
        </form>

        {/* Demo Credentials */}
        <div className="mt-10 p-5 bg-blue-50/50 border border-blue-100/50 rounded-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-blue-800 mb-3">
            {t('Zugangsdaten (Test)', 'Test Credentials')}
          </p>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between bg-white px-4 py-2.5 rounded-xl shadow-sm border border-slate-100">
              <span className="text-slate-500">{t('Kundennummer', 'Customer No.')}</span>
              <strong className="select-all text-slate-900 font-mono">DOC10025</strong>
            </div>
            <div className="flex items-center justify-between bg-white px-4 py-2.5 rounded-xl shadow-sm border border-slate-100">
              <span className="text-slate-500">{t('Zugangscode', 'Access Code')}</span>
              <strong className="select-all text-slate-900 font-mono">M3D9X7P8</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
