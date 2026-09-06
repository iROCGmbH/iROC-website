import { useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Facebook,
  Home,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  Menu,
  Phone,
  Video,
  X,
  Youtube,
} from "lucide-react";

import "./_group.css";

const navItems = [
  { label: "Startseite", icon: Home },
  { label: "Arzt finden", icon: MapPin },
  { label: "Karpaltunnelsyndrom", icon: Activity },
  { label: "Schnappfinger", icon: Activity },
  { label: "Praktische Informationen", icon: BookOpen },
  { label: "Postoperative Entwicklung", icon: Activity },
  { label: "Erfahrungsberichte", icon: Video },
];

const benefits = [
  "Kein Hautschnitt",
  "Kein Verband oder Narbe nach dem Eingriff",
  "Unmittelbare Rückkehr in den Alltag",
  "Spezifisches Instrument für zwei häufige Handbeschwerden: Karpaltunnelsyndrom und Schnappfinger",
];

function Instrument({ type }: { type: "ct" | "tf" }) {
  const label = type === "ct" ? "CT" : "TF";
  return (
    <div className="relative flex h-32 w-24 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-white to-slate-100 sm:h-48 sm:w-48">
      <div className="absolute h-[88%] w-1 rounded-full bg-slate-400" />
      <div className="absolute top-[12%] h-8 w-12 rounded-md border border-slate-300 bg-white shadow-sm" />
      <div className="absolute top-[14%] text-[10px] font-bold tracking-wider text-primary">{label}</div>
      <div className="absolute bottom-[10%] h-8 w-8 rounded-full border-4 border-primary/80 bg-white shadow-sm" />
    </div>
  );
}

function NavLink({ label, Icon, selected = false }: { label: string; Icon: typeof Home; selected?: boolean }) {
  return (
    <a
      href="#content"
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all whitespace-nowrap ${
        selected
          ? "border-primary bg-primary text-white shadow-sm"
          : "border-gray-200 bg-white text-gray-600 hover:border-primary/50 hover:text-primary"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </a>
  );
}

export function Current() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="spirecut-app-shell min-h-screen bg-background">
      <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 bg-black px-3 py-2 text-xs sm:text-sm">
        <span className="font-medium text-white">Sind Sie Arzt oder Ärztin?</span>
        <a href="#doctor" className="rounded bg-primary px-3 py-0.5 font-bold text-white transition-colors hover:bg-primary/90">
          Zur Ärzteseite →
        </a>
      </div>

      <header className="fixed inset-x-0 top-[32px] z-50 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-white text-xs text-gray-500">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 lg:px-8">
            <div className="flex items-center gap-4 sm:gap-5">
              <a href="mailto:info@spirecut.de" className="flex items-center gap-1.5 hover:text-primary">
                <Mail className="h-3 w-3" /><span className="hidden sm:inline">info@spirecut.de</span><span className="sm:hidden">E-Mail</span>
              </a>
              <a href="tel:+4989462599370" className="flex items-center gap-1.5 hover:text-primary">
                <Phone className="h-3 w-3" /><span className="hidden sm:inline">+49 89 4625993 70</span><span className="sm:hidden">Anrufen</span>
              </a>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-3 sm:flex">
                <Instagram className="h-3.5 w-3.5" /><Youtube className="h-3.5 w-3.5" /><Linkedin className="h-3.5 w-3.5" /><Facebook className="h-3.5 w-3.5" />
              </div>
              <button className="flex items-center gap-1 font-medium text-gray-600">DE <ChevronDown className="h-3 w-3" /></button>
            </div>
          </div>
        </div>

        <div className="relative mx-auto flex max-w-7xl items-center justify-between px-4 py-4 lg:px-8">
          <a href="#content" className="spirecut-logo" aria-label="Spirecut">spirecut<small>®</small></a>
          <nav className="hidden items-center gap-1.5 xl:flex">
            {navItems.map(({ label, icon: Icon }, index) => <NavLink key={label} label={label} Icon={Icon} selected={index === 0} />)}
          </nav>
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:border-primary/50 hover:text-primary xl:hidden"
            aria-label="Menü öffnen"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          {menuOpen && (
            <div className="absolute left-0 right-0 top-full border-t border-gray-100 bg-white px-4 py-3 shadow-lg xl:hidden">
              <nav className="flex flex-col gap-1">
                {navItems.map(({ label, icon: Icon }, index) => <NavLink key={label} label={label} Icon={Icon} selected={index === 0} />)}
              </nav>
            </div>
          )}
        </div>
      </header>

      <main id="content" className="pt-[144px]">
        <section className="hero-backdrop relative overflow-hidden py-14 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 lg:px-8">
            <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
              <div>
                <h1 className="mb-6 text-4xl font-bold leading-tight text-gray-900 lg:text-5xl">Informationen für Patienten über perkutane Handchirurgie</h1>
                <p className="mb-5 leading-relaxed text-gray-600">Perkutane Handchirurgie ist eine minimalinvasive Technik zur Behandlung häufiger Beschwerden wie dem Karpaltunnelsyndrom und dem Schnappfinger.</p>
                <p className="mb-5 leading-relaxed text-gray-600">Mit speziellen Instrumenten von Spirecut und unter Ultraschallkontrolle können Chirurgen diese Eingriffe mit hoher Sicherheit und ohne Hautschnitt durchführen.</p>
                <p className="mb-8 leading-relaxed text-gray-600">Diese Website bietet klare Informationen über die Eingriffe und hilft Patienten, sich auf den chirurgischen und postoperativen Prozess vorzubereiten.</p>
                <div className="flex flex-col gap-4 sm:flex-row">
                  <a href="#conditions" className="inline-flex h-11 items-center justify-center gap-2 rounded px-7 text-sm font-semibold text-white bg-primary transition-colors hover:bg-primary/90">Praktische Informationen <ArrowRight className="h-4 w-4" /></a>
                  <a href="#doctor" className="inline-flex h-11 items-center justify-center gap-2 rounded border border-primary px-7 text-sm font-semibold text-primary hover:bg-primary/5"><MapPin className="h-4 w-4" /> Arzt finden</a>
                </div>
                <p className="mt-5 text-sm text-gray-500">⭐ 4.9 / 5 — 126 Patienten haben ihr Ergebnis bewertet</p>
              </div>
              <div className="flex justify-center">
                <div className="flex items-stretch gap-4 rounded-2xl bg-white/50 p-3 backdrop-blur-sm">
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 shadow-sm sm:p-6"><Instrument type="ct" /></div>
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 shadow-sm sm:p-6"><Instrument type="tf" /></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-gray-100 bg-gray-50 py-14 lg:py-16">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 lg:grid-cols-2 lg:gap-16 lg:px-8">
            <div>
              <h2 className="mb-6 text-3xl font-bold">Was ist perkutane Handchirurgie?</h2>
              <p className="mb-4 leading-relaxed text-gray-600">Das Spirecut-Verfahren ist eine <strong>perkutane</strong> (lat. „durch die Haut”) Methode. Der gesamte Eingriff erfolgt durch einen Nadelstich – er heilt innerhalb eines Tages, ohne Naht.</p>
              <p className="mb-4 leading-relaxed text-gray-600">Die Behandlung erfolgt unter <strong>Ultraschall</strong>, wie bei einer Schwangerschaftsuntersuchung. Dies ermöglicht dem Chirurgen, Nerven, Blutgefäße und Bänder in der Hand deutlich besser zu sehen als bei einer offenen Operation.</p>
              <p className="leading-relaxed text-gray-600">Die Spirecut-Instrumente haben einen Durchmesser von nur <strong>1,5 mm</strong> und werden durch den Nadelstich eingeführt.</p>
            </div>
            <div>
              <h2 className="mb-6 text-3xl font-bold">Was sind die Vorteile?</h2>
              <ul className="space-y-3">
                {benefits.map((benefit) => <li key={benefit} className="flex items-start gap-3 text-sm text-gray-700"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />{benefit}</li>)}
              </ul>
              <p className="mt-8 rounded-xl border border-primary/20 bg-primary/5 p-5 text-sm italic text-gray-600">„Spirecut ist ein Schweizer Unternehmen, das Instrumente entwickelt hat, die ultraschallgeführte Eingriffe ohne Hautschnitt ermöglichen.”</p>
            </div>
          </div>
        </section>

        <section id="conditions" className="py-14 lg:py-16">
          <div className="mx-auto max-w-7xl px-4 lg:px-8">
            <h2 className="mb-3 text-center text-3xl font-bold">Behandelte Beschwerden</h2><div className="mx-auto mb-12 h-0.5 w-10 bg-primary" />
            <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
              {[["ct", "Karpaltunnelsyndrom", "Kribbeln, Taubheit oder Schmerzen in den Fingern? Das Spirecut-Sono-Instrument durchtrennt sanft und präzise das einengende Querband des Karpaltunnels."], ["tf", "Schnappfinger (Triggerfinger)", "Ein Finger blockiert oder schnappt beim Beugen? Die Ringbandspaltung mit Spirecut befreit die Sehne präzise unter Ultraschall – ohne Skalpell."]].map(([type, title, text]) => (
                <article key={type} className="rounded-xl border border-gray-200 p-6 transition-all hover:border-primary/30 hover:shadow-sm sm:p-8">
                  <div className="mb-6 flex h-40 items-center justify-center rounded-lg bg-gray-50"><Instrument type={type as "ct" | "tf"} /></div>
                  <h3 className="mb-3 text-xl font-bold">{title}</h3><p className="mb-5 text-sm leading-relaxed text-gray-500">{text}</p>
                  <a href="#content" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">Mehr erfahren <ArrowRight className="h-4 w-4" /></a>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer id="doctor" className="border-t border-gray-200 bg-white px-4 pb-8 pt-12 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-3">
          <div><div className="spirecut-logo mb-5">spirecut<small>®</small></div><p className="text-sm leading-relaxed text-gray-500">Hofackerstrasse 40B<br />CH – 4132 Muttenz<br />CHE-209.831.310</p><p className="mt-3 text-sm text-gray-500">+41 26 505 18 38<br />info@spirecut.com</p></div>
          <div><h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Seiten</h4><ul className="space-y-2.5 text-sm text-gray-600"><li>Startseite</li><li>Arzt finden</li><li>Praktische Informationen</li><li>Häufige Fragen</li></ul></div>
          <div><h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Rechtliches</h4><ul className="mb-8 space-y-2.5 text-sm text-gray-600"><li>Impressum</li><li>Datenschutz</li></ul><p className="text-sm leading-relaxed text-gray-500">iROC GmbH<br />St.-Emmeram-Str. 26<br />85609 Aschheim</p></div>
        </div>
        <div className="mx-auto mt-10 flex max-w-7xl flex-col items-center justify-between gap-5 border-t border-gray-100 pt-7 text-xs text-gray-400 md:flex-row"><span>© 2025 Spirecut. Alle Rechte vorbehalten.</span><span className="font-semibold tracking-[0.25em] text-gray-400">SWISS MADE · FDA · CE · ISO</span></div>
      </footer>
    </div>
  );
}

export default Current;