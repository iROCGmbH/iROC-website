import { useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  HeartPulse,
  Home,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  X,
} from "lucide-react";

import "./_group.css";

const navItems = [
  { label: "Übersicht", icon: Home, href: "#start" },
  { label: "Beschwerden", icon: Activity, href: "#conditions" },
  { label: "Praktische Infos", icon: BookOpen, href: "#practical" },
  { label: "Arzt finden", icon: MapPin, href: "#doctor" },
];

const benefits = [
  "Kein Hautschnitt",
  "Kein Verband oder Narbe nach dem Eingriff",
  "Unmittelbare Rückkehr in den Alltag",
  "Spezifisches Instrument für Karpaltunnelsyndrom und Schnappfinger",
];

function Instrument({ type }: { type: "ct" | "tf" }) {
  return (
    <div className="relative flex h-40 w-24 items-center justify-center overflow-hidden rounded-[1.25rem] border border-white/70 bg-gradient-to-br from-[#fffdfa] to-[#dfe9e5] shadow-inner sm:h-52 sm:w-32">
      <div className="absolute h-[92%] w-1 rounded-full bg-[#8da29d]" />
      <div className="absolute top-[12%] flex h-9 w-14 items-center justify-center rounded-lg border border-[#cbd9d4] bg-white/90 shadow-sm">
        <span className="text-[10px] font-bold tracking-[.22em] text-primary">{type === "ct" ? "CT" : "TF"}</span>
      </div>
      <div className="absolute bottom-[10%] h-10 w-10 rounded-full border-[5px] border-primary/70 bg-[#fbf5eb] shadow-sm" />
    </div>
  );
}

function AppNav({ onNavigate }: { onNavigate: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {navItems.map(({ label, icon: Icon, href }, index) => (
        <a
          key={label}
          href={href}
          onClick={onNavigate}
          className={`pressable flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold ${
            index === 0 ? "bg-primary text-white shadow-[0_8px_20px_rgba(150,45,58,.18)]" : "text-foreground/65 hover:bg-[#f4ebe0] hover:text-foreground"
          }`}
        >
          <Icon className="h-4 w-4" />
          {label}
        </a>
      ))}
    </nav>
  );
}

export function AppLike() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [language, setLanguage] = useState<"DE" | "EN">("DE");
  const [searchOpen, setSearchOpen] = useState(false);
  const copy = language === "DE"
    ? {
        greeting: "Gut, dass Sie da sind.",
        title: "Klarheit für Ihre Hand.",
        body: "Verstehen Sie Beschwerden, Eingriff und Erholung in Ihrem eigenen Tempo. Spirecut begleitet Sie mit verständlichen Informationen — vor und nach der Behandlung.",
        primary: "Praktische Informationen",
        secondary: "Arzt in der Nähe finden",
        overview: "Ihr Überblick",
        overviewBody: "Alles Wichtige, ruhig erklärt.",
        conditions: "Womit dürfen wir Sie heute unterstützen?",
        detail: "Mehr erfahren",
        practical: "Gut vorbereitet sein",
      }
    : {
        greeting: "Good to have you here.",
        title: "Clarity for your hand.",
        body: "Understand your symptoms, procedure and recovery at your own pace. Spirecut gives you clear, reassuring information before and after treatment.",
        primary: "Practical information",
        secondary: "Find a doctor nearby",
        overview: "Your overview",
        overviewBody: "Everything important, calmly explained.",
        conditions: "How can we support you today?",
        detail: "Learn more",
        practical: "Feel prepared",
      };

  const toggleLanguage = () => setLanguage((current) => current === "DE" ? "EN" : "DE");

  return (
    <div className="spirecut-app-shell min-h-screen bg-background">
      <div className="flex min-h-9 items-center justify-center gap-3 bg-[#253a3d] px-4 py-2 text-[11px] font-medium tracking-wide text-[#f5efe6] sm:text-xs">
        <ShieldCheck className="h-3.5 w-3.5 text-[#cbded4]" />
        <span>{language === "DE" ? "Patientenbereich · Informationen, denen Sie vertrauen können" : "Patient area · Information you can trust"}</span>
        <a href="https://www.i-roc.de" className="hidden text-[#e7a49f] underline underline-offset-4 sm:inline">{language === "DE" ? "Für Ärzte" : "For physicians"}</a>
      </div>

      <div className="mx-auto flex min-h-[calc(100vh-36px)] max-w-[1500px] flex-col lg:flex-row">
        <aside className="hidden w-[252px] shrink-0 border-r border-[#e5ddd2] bg-[#fbf6ee] px-5 py-7 lg:flex lg:flex-col">
          <a href="#start" className="spirecut-logo mb-12 flex items-center px-3 text-[1.8rem]">spirecut<small>®</small></a>
          <p className="mb-4 px-3 text-[10px] font-bold uppercase tracking-[.22em] text-foreground/35">{language === "DE" ? "Ihre Begleitung" : "Your companion"}</p>
          <AppNav onNavigate={() => undefined} />
          <div className="mt-auto rounded-2xl bg-[#e5eee9] p-4">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-primary shadow-sm"><HeartPulse className="h-4 w-4" /></div>
            <p className="app-display text-sm font-bold">{language === "DE" ? "Fragen sind willkommen." : "Questions are welcome."}</p>
            <p className="mt-1 text-xs leading-relaxed text-foreground/55">{language === "DE" ? "Speichern Sie diese Seite für später." : "Save this page for later."}</p>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-[70px] items-center justify-between border-b border-[#e9e1d7]/80 bg-[#fbf6ee]/90 px-5 backdrop-blur-md sm:px-8 lg:px-10">
            <div className="flex items-center gap-3 lg:hidden">
              <button type="button" aria-label="Menü öffnen" onClick={() => setMenuOpen(true)} className="pressable flex h-10 w-10 items-center justify-center rounded-xl border border-[#ded5c9] bg-[#fffaf4] text-foreground"><Menu className="h-4 w-4" /></button>
              <a href="#start" className="spirecut-logo text-[1.45rem]">spirecut<small>®</small></a>
            </div>
            <div className="hidden items-center gap-2 text-xs font-semibold text-foreground/45 lg:flex"><span className="h-2 w-2 rounded-full bg-[#83a899]" /> {language === "DE" ? "Ihr persönlicher Patientenbereich" : "Your personal patient area"}</div>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => setSearchOpen((open) => !open)} aria-label="Suche öffnen" className="pressable flex h-10 w-10 items-center justify-center rounded-xl text-foreground/55 hover:bg-[#f1e8dc] hover:text-foreground"><Search className="h-4 w-4" /></button>
              <button type="button" onClick={toggleLanguage} className="pressable flex h-10 items-center gap-1 rounded-xl border border-[#ded5c9] bg-[#fffaf4] px-3 text-xs font-bold text-foreground/70">{language}<ChevronDown className="h-3 w-3" /></button>
            </div>
            {searchOpen && <div className="absolute right-5 top-[62px] flex w-[min(320px,calc(100vw-40px))] items-center gap-2 rounded-2xl border border-[#ded5c9] bg-[#fffaf4] p-2 shadow-xl"><Search className="ml-2 h-4 w-4 text-foreground/40" /><input autoFocus placeholder={language === "DE" ? "Was möchten Sie wissen?" : "What would you like to know?"} className="w-full bg-transparent px-1 py-2 text-sm outline-none" /></div>}
          </header>

          <main id="start" className="px-5 pb-16 pt-8 sm:px-8 lg:px-12 lg:pt-12">
            <section className="hero-backdrop rise-in relative overflow-hidden rounded-[2rem] border border-[#e8ddd0] px-6 py-8 sm:px-10 sm:py-11 lg:px-14 lg:py-14">
              <div className="relative z-10 max-w-[650px]">
                <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#d6e0d8] bg-[#f9fbf7]/80 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-[#53786c]"><Sparkles className="h-3.5 w-3.5" /> {language === "DE" ? "Für Patienten" : "For patients"}</div>
                <p className="mb-3 text-sm font-semibold text-primary">{copy.greeting}</p>
                <h1 className="app-display max-w-xl text-4xl font-extrabold leading-[1.05] tracking-[-.055em] text-foreground sm:text-6xl">{copy.title}</h1>
                <p className="mt-6 max-w-xl text-[15px] leading-7 text-foreground/65 sm:text-base">{copy.body}</p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <a href="#practical" className="pressable inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(150,45,58,.2)]">{copy.primary}<ArrowRight className="h-4 w-4" /></a>
                  <a href="#doctor" className="pressable inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[#d5c7b9] bg-[#fffaf4]/70 px-5 text-sm font-bold text-foreground"><MapPin className="h-4 w-4 text-primary" />{copy.secondary}</a>
                </div>
              </div>
              <div className="pointer-events-none absolute -right-8 bottom-[-22px] hidden items-end gap-3 opacity-90 sm:flex lg:right-12"><Instrument type="ct" /><Instrument type="tf" /></div>
              <div className="pointer-events-none absolute right-8 top-8 h-24 w-24 rounded-full border border-primary/20" />
            </section>

            <section className="rise-in-delay mt-8 grid gap-4 sm:grid-cols-[1.15fr_.85fr]">
              <div className="rounded-2xl border border-[#e7ddd1] bg-[#fffaf4] p-5 sm:p-6">
                <div className="mb-5 flex items-start justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-foreground/35">{copy.overview}</p><h2 className="app-display mt-2 text-xl font-bold">{copy.overviewBody}</h2></div><div className="rounded-xl bg-[#e7efe9] p-2.5 text-[#557c70]"><Stethoscope className="h-5 w-5" /></div></div>
                <div className="flex items-center gap-4 rounded-xl bg-[#f4eee5] p-3"><div className="flex h-11 w-11 items-center justify-center rounded-full border-4 border-[#9db8ab] text-xs font-bold text-[#53786c]">01</div><div className="text-sm"><p className="font-bold">{language === "DE" ? "Informieren" : "Learn"}</p><p className="text-xs text-foreground/50">{language === "DE" ? "Beschwerden besser verstehen" : "Understand your condition"}</p></div><Check className="ml-auto h-4 w-4 text-[#6f9888]" /></div>
              </div>
              <div className="rounded-2xl bg-[#253a3d] p-5 text-[#f8f2e9] sm:p-6"><div className="mb-8 flex items-center justify-between"><div className="rounded-xl bg-white/10 p-2.5"><MessageCircle className="h-5 w-5 text-[#e5b0aa]" /></div><span className="text-xs text-white/45">{language === "DE" ? "Jederzeit" : "Anytime"}</span></div><h2 className="app-display text-xl font-bold">{language === "DE" ? "Nicht sicher, wo Sie anfangen sollen?" : "Not sure where to start?"}</h2><a href="#conditions" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#efb1aa]">{language === "DE" ? "Beschwerden ansehen" : "Explore conditions"}<ArrowRight className="h-4 w-4" /></a></div>
            </section>

            <section id="conditions" className="mt-14 scroll-mt-24">
              <div className="mb-6 flex items-end justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.18em] text-primary">{language === "DE" ? "Orientierung" : "Orientation"}</p><h2 className="app-display mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">{copy.conditions}</h2></div><a href="#conditions" className="hidden items-center gap-1 text-sm font-bold text-primary sm:flex">{language === "DE" ? "Alle Inhalte" : "All content"}<ArrowRight className="h-4 w-4" /></a></div>
              <div className="grid gap-4 md:grid-cols-2">
                <article className="pressable group rounded-2xl border border-[#e7ddd1] bg-[#fffaf4] p-5 sm:p-6"><div className="mb-6 flex h-36 items-center justify-center rounded-xl bg-[#edf2ed]"><Instrument type="ct" /></div><div className="flex items-start justify-between gap-3"><div><h3 className="app-display text-lg font-bold">{language === "DE" ? "Karpaltunnelsyndrom" : "Carpal Tunnel Syndrome"}</h3><p className="mt-2 max-w-sm text-sm leading-6 text-foreground/55">{language === "DE" ? "Kribbeln, Taubheit oder Schmerzen in den Fingern?" : "Tingling, numbness or pain in your fingers?"}</p></div><div className="rounded-full bg-[#f5e2df] p-2 text-primary"><Activity className="h-4 w-4" /></div></div><a href="#practical" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-primary">{copy.detail}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></a></article>
                <article className="pressable group rounded-2xl border border-[#e7ddd1] bg-[#fffaf4] p-5 sm:p-6"><div className="mb-6 flex h-36 items-center justify-center rounded-xl bg-[#edf2ed]"><Instrument type="tf" /></div><div className="flex items-start justify-between gap-3"><div><h3 className="app-display text-lg font-bold">{language === "DE" ? "Schnappfinger" : "Trigger Finger"}</h3><p className="mt-2 max-w-sm text-sm leading-6 text-foreground/55">{language === "DE" ? "Blockiert oder schnappt ein Finger beim Beugen?" : "Does a finger lock or snap when bending?"}</p></div><div className="rounded-full bg-[#e4eee9] p-2 text-[#557c70]"><Activity className="h-4 w-4" /></div></div><a href="#practical" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-primary">{copy.detail}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></a></article>
              </div>
            </section>

            <section id="practical" className="mt-14 scroll-mt-24 rounded-2xl bg-[#e7efe9] p-6 sm:p-8"><div className="grid items-center gap-8 md:grid-cols-[1fr_auto]"><div><div className="mb-4 flex items-center gap-2 text-[#52786d]"><Clock3 className="h-4 w-4" /><span className="text-[11px] font-bold uppercase tracking-[.16em]">{language === "DE" ? "Vorbereitung" : "Preparation"}</span></div><h2 className="app-display text-2xl font-extrabold">{copy.practical}</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-foreground/60">{language === "DE" ? "Erfahren Sie, wie die Behandlung abläuft und was Sie danach erwarten können. Bitte befolgen Sie stets die Anweisungen Ihres behandelnden Arztes." : "Learn how the procedure works and what to expect afterwards. Always follow the instructions of your treating physician."}</p></div><a href="#doctor" className="pressable inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#253a3d] px-5 text-sm font-bold text-white">{language === "DE" ? "Ablauf ansehen" : "See the process"}<ArrowRight className="h-4 w-4" /></a></div></section>
          </main>
          <footer id="doctor" className="border-t border-[#e8ded2] px-5 py-8 sm:px-8 lg:px-12"><div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="spirecut-logo text-[1.35rem]">spirecut<small>®</small></div><p className="mt-2 text-xs text-foreground/45">{language === "DE" ? "Verlässliche Orientierung für Ihre Hand." : "Trusted guidance for your hand."}</p></div><div className="flex flex-wrap gap-4 text-xs font-semibold text-foreground/45"><a href="mailto:info@spirecut.de" className="inline-flex items-center gap-1.5 hover:text-primary"><MessageCircle className="h-3.5 w-3.5" /> info@spirecut.de</a><a href="tel:+4989462599370" className="inline-flex items-center gap-1.5 hover:text-primary"><Phone className="h-3.5 w-3.5" /> +49 89 4625993 70</a></div></div></footer>
        </div>
      </div>

      {menuOpen && <div className="fixed inset-0 z-50 bg-[#253a3d]/20 backdrop-blur-sm lg:hidden" onClick={() => setMenuOpen(false)}><aside className="h-full w-[min(300px,84vw)] bg-[#fbf6ee] p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="mb-12 flex items-center justify-between"><span className="spirecut-logo text-[1.55rem]">spirecut<small>®</small></span><button type="button" aria-label="Menü schließen" onClick={() => setMenuOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#ded5c9]"><X className="h-4 w-4" /></button></div><AppNav onNavigate={() => setMenuOpen(false)} /></aside></div>}
    </div>
  );
}

export default AppLike;