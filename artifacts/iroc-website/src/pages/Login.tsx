import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useDoctorLogin, LoginInputInstrument } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Lock } from 'lucide-react';

export default function Login() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { checkAuth } = useAuth();
  const queryClient = useQueryClient();
  
  const [instrument, setInstrument] = useState<LoginInputInstrument>('spirecut');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const loginMut = useDoctorLogin({
    mutation: {
      onSuccess: async () => {
        // Wipe cached resources so the new session's instrument filter takes effect immediately.
        // Without this, React Query serves the previous session's resources from cache.
        queryClient.removeQueries({ queryKey: ['resources'] });
        await checkAuth();
        setLocation('/portal');
        toast({ title: t('Erfolgreich', 'Success'), description: t('Anmeldung erfolgreich.', 'Login successful.') });
      },
      onError: () => {
        toast({ variant: 'destructive', title: 'Error', description: t('Falsches Passwort.', 'Incorrect password.') });
      }
    }
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMut.mutate({ data: { instrument, password } });
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-muted/20 py-20 px-4">
      <div className="max-w-md w-full bg-white rounded-3xl border shadow-xl p-8 md:p-10">
        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-8 mx-auto text-primary">
          <Lock className="w-8 h-8" />
        </div>
        
        <h1 className="text-3xl font-bold text-center mb-2">{t('Arzt Portal', 'Doctor Portal')}</h1>
        <p className="text-muted-foreground text-center mb-10 text-sm">
          {t(
            'Bitte wählen Sie Ihr Instrument und geben Sie das Passwort ein, das Sie nach der Zertifizierung erhalten haben.',
            'Please select your instrument and enter the password you received after certification.'
          )}
        </p>

        <form onSubmit={onSubmit} className="space-y-6">
          <div className="space-y-3">
            <label className="text-sm font-medium">{t('Instrument', 'Instrument')}</label>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setInstrument('spirecut')}
                className={`py-3 rounded-xl border-2 font-medium transition-all ${
                  instrument === 'spirecut' 
                    ? 'border-primary bg-primary/5 text-primary' 
                    : 'border-transparent bg-muted hover:bg-muted/80 text-muted-foreground'
                }`}
              >
                Spirecut®
              </button>
              <button
                type="button"
                onClick={() => setInstrument('ministem')}
                className={`py-3 rounded-xl border-2 font-medium transition-all ${
                  instrument === 'ministem' 
                    ? 'border-primary bg-primary/5 text-primary' 
                    : 'border-transparent bg-muted hover:bg-muted/80 text-muted-foreground'
                }`}
              >
                MiniStem®
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">{t('Passwort', 'Password')}</label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="h-12 bg-muted/50 pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? t('Passwort ausblenden', 'Hide password') : t('Passwort anzeigen', 'Show password')}
                aria-pressed={showPassword}
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <Button type="submit" size="lg" className="w-full h-14 text-lg rounded-xl mt-4" disabled={loginMut.isPending}>
            {loginMut.isPending ? t('Prüfe...', 'Checking...') : t('Anmelden', 'Login')}
          </Button>
        </form>
      </div>
    </div>
  );
}
