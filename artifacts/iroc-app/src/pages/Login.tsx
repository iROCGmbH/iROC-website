import { useEffect, useState } from "react";
import irocLogo from "@/assets/iroc-new-logo.svg";
import { useLocation } from "wouter";
import { consumeSessionExpiredMessage, useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { useIrocLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { Eye, EyeOff, Loader2, Globe } from "lucide-react";

export default function Login() {
  const logoSrc = irocLogo;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(() => consumeSessionExpiredMessage());
  const [error, setError] = useState("");

  const [, setLocation] = useLocation();
  const { setAuth } = useAuth();
  const { lang, toggleLang } = useLanguage();

  useEffect(() => {
    if (sessionExpired) {
      setError(
        lang === "de"
          ? "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an."
          : "Your session has expired, please log in again.",
      );
    }
  }, [lang, sessionExpired]);

  const loginMutation = useIrocLogin({
    mutation: {
      onSuccess: (data) => {
        setAuth(data.token, data.username);
        setLocation("/");
      },
      onError: () => {
        setError(lang === "de" ? "Anmeldung fehlgeschlagen. Bitte überprüfen Sie Ihre Zugangsdaten." : "Login failed. Please check your credentials.");
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSessionExpired(false);
    setError("");
    loginMutation.mutate({ data: { username, password } });
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-muted/30 p-4 relative">
      {/* Language toggle — top right */}
      <div className="absolute top-4 right-4">
        <button
          type="button"
          onClick={toggleLang}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-muted"
        >
          <Globe className="h-3.5 w-3.5" />
          {lang === "de" ? "EN" : "DE"}
        </button>
      </div>

      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="space-y-2 text-center pb-8">
          <div className="flex justify-center mb-2">
            <img
              src={logoSrc}
              alt="iROC GmbH — Innovative & Regenerative medical Oriented Consultation"
              className="h-auto w-full max-w-[280px] object-contain"
            />
          </div>
          <CardDescription>
            {lang === "de" ? "Interne Geschäftsverwaltung" : "Internal Business Management"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t("username", lang)}</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={loginMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("password", lang)}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loginMutation.isPending}
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword
                    ? (lang === "de" ? "Passwort ausblenden" : "Hide password")
                    : (lang === "de" ? "Passwort anzeigen" : "Show password")}
                  aria-pressed={showPassword}
                  className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm text-destructive font-medium p-3 bg-destructive/10 rounded-md">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full mt-6" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("login", lang)
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
