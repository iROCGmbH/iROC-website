import { Link, useLocation } from "wouter";
import { useState, useEffect, useRef } from "react";
import { Mail, Phone, Instagram, Youtube, Linkedin, Menu, X, HeartPulse } from "lucide-react";
import { fetchSocialLinks, SOCIAL_DEFAULTS } from "@/hooks/useSocialLinks";
import { TikTokIcon, FacebookIcon } from "@/components/SocialIcons";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";
import { PAGE_LINKS } from "@/config/navLinks";

export function Navigation() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const [socials, setSocials] = useState(SOCIAL_DEFAULTS);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => { fetchSocialLinks().then(setSocials); }, []);
  useEffect(() => { setMenuOpen(false); }, [location]);
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
      if (event.key === "Tab") {
        const dialog = document.getElementById("mobile-navigation");
        const focusable = dialog?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      opener.current?.focus();
    };
  }, [menuOpen]);

  const navItems = (onNavigate?: () => void) => PAGE_LINKS.map(({ href, navLabelKey, Icon }) => (
    <Link key={href} href={href}>
      <span onClick={onNavigate} className={`app-pressable flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold cursor-pointer focus-visible:outline-none ${
        location === href ? "bg-primary text-white shadow-[0_8px_20px_rgba(150,45,58,.18)]" : "text-foreground/65 hover:bg-[#f4ebe0] hover:text-foreground"
      }`}>
        <Icon className="h-4 w-4 shrink-0" />{t(navLabelKey)}
      </span>
    </Link>
  ));

  const SocialLinks = ({ compact = false }: { compact?: boolean }) => (
    <div className={`flex items-center ${compact ? "gap-3" : "gap-2"}`}>
      {socials.instagram && <a aria-label="Instagram" href={socials.instagram} target="_blank" rel="noopener noreferrer" className="hover:text-primary"><Instagram className="h-4 w-4" /></a>}
      {socials.youtube && <a aria-label="YouTube" href={socials.youtube} target="_blank" rel="noopener noreferrer" className="hover:text-primary"><Youtube className="h-4 w-4" /></a>}
      {socials.linkedin && <a aria-label="LinkedIn" href={socials.linkedin} target="_blank" rel="noopener noreferrer" className="hover:text-primary"><Linkedin className="h-4 w-4" /></a>}
      {socials.tiktok && <a aria-label="TikTok" href={socials.tiktok} target="_blank" rel="noopener noreferrer" className="hover:text-primary"><TikTokIcon className="h-4 w-4" /></a>}
      {socials.facebook && <a aria-label="Facebook" href={socials.facebook} target="_blank" rel="noopener noreferrer" className="hover:text-primary"><FacebookIcon className="h-4 w-4" /></a>}
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-9 left-0 z-50 hidden w-[252px] flex-col border-r border-[#e5ddd2] bg-[#fbf6ee] px-5 py-7 lg:flex">
        <Link href="/"><img src={`${import.meta.env.BASE_URL}spirecut-logo.webp`} alt="Spirecut" className="mb-12 h-9 w-auto object-contain object-left" /></Link>
        <p className="mb-4 px-3 text-[10px] font-bold uppercase tracking-[.22em] text-foreground/40">{t("appNav.companion")}</p>
        <nav className="flex flex-col gap-1" aria-label={t("nav.openMenu")}>{navItems()}</nav>
        <div className="mt-auto rounded-2xl bg-[#e5eee9] p-4">
          <HeartPulse className="mb-3 h-5 w-5 text-primary" />
          <p className="app-display text-sm font-bold">{t("appNav.questionsTitle")}</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground/55">{t("appNav.questionsBody")}</p>
        </div>
      </aside>

      <header className="fixed left-0 right-0 top-9 z-50 border-b border-[#e9e1d7] bg-[#fbf6ee]/95 backdrop-blur-md lg:left-[252px]">
        <div className="mx-auto flex h-[70px] max-w-[1500px] items-center justify-between px-4 sm:px-7 lg:px-10">
          <div className="hidden items-center gap-2 text-xs font-semibold text-foreground/50 lg:flex"><span className="h-2 w-2 rounded-full bg-[#83a899]" /> {t("appNav.patientArea")}</div>
          <div className="flex items-center gap-3 lg:hidden">
            <button ref={opener} type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-controls="mobile-navigation" aria-label={t("nav.openMenu")} className="app-pressable flex h-10 w-10 items-center justify-center rounded-xl border border-[#ded5c9] bg-[#fffaf4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Menu className="h-4 w-4" /></button>
            <Link href="/"><img src={`${import.meta.env.BASE_URL}spirecut-logo.webp`} alt="Spirecut" className="h-8 w-auto object-contain" /></Link>
          </div>
          <div className="ml-auto flex items-center gap-4 text-foreground/55">
            <div className="hidden sm:flex"><SocialLinks /></div>
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-[70] bg-[#253a3d]/30 backdrop-blur-sm lg:hidden" onMouseDown={() => setMenuOpen(false)}>
          <aside id="mobile-navigation" role="dialog" aria-modal="true" aria-label={t("nav.openMenu")} className="h-full w-[min(310px,86vw)] bg-[#fbf6ee] p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-10 flex items-center justify-between">
              <img src={`${import.meta.env.BASE_URL}spirecut-logo.webp`} alt="Spirecut" className="h-9 w-auto" />
              <button ref={closeButton} type="button" onClick={() => setMenuOpen(false)} aria-label={t("appNav.closeMenu")} className="app-pressable flex h-10 w-10 items-center justify-center rounded-xl border border-[#ded5c9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X className="h-4 w-4" /></button>
            </div>
            <nav className="flex flex-col gap-1">{navItems(() => setMenuOpen(false))}</nav>
            <div className="mt-7 border-t border-[#e5ddd2] pt-5"><LanguageSwitcher /><div className="mt-5 text-foreground/55"><SocialLinks compact /></div></div>
            <div className="mt-7 text-xs text-foreground/55"><a href="mailto:info@spirecut.de" className="mb-2 flex items-center gap-2 hover:text-primary"><Mail className="h-3.5 w-3.5" />info@spirecut.de</a><a href="tel:+4989462599370" className="flex items-center gap-2 hover:text-primary"><Phone className="h-3.5 w-3.5" />+49 89 4625993 70</a></div>
          </aside>
        </div>
      )}
    </>
  );
}