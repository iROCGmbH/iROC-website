import { Link, useLocation } from "wouter";
import { useState, useEffect, useRef } from "react";
import {
  Mail, Phone, Instagram, Youtube, Linkedin,
  Menu, X,
} from "lucide-react";
import { fetchSocialLinks, SOCIAL_DEFAULTS } from "@/hooks/useSocialLinks";
import { TikTokIcon, FacebookIcon } from "@/components/SocialIcons";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";
import { PAGE_LINKS } from "@/config/navLinks";

export function Navigation() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const [isScrolled, setIsScrolled] = useState(false);
  const [socials, setSocials] = useState(SOCIAL_DEFAULTS);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    fetchSocialLinks().then(setSocials);
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Close menu on navigation
  useEffect(() => { setMenuOpen(false); }, [location]);

  return (
    <header className={`fixed top-[32px] left-0 right-0 z-50 bg-white transition-shadow duration-200 ${isScrolled ? "shadow-sm" : ""}`}>

      {/* Top bar — email / phone / social */}
      <div className="border-b border-gray-100 bg-white text-xs text-gray-500">
        <div className="container mx-auto px-4 lg:px-8 py-2 flex justify-between items-center">
          <div className="flex items-center gap-5">
            <a href="mailto:info@spirecut.de" className="flex items-center gap-1.5 hover:text-primary transition-colors">
              <Mail className="h-3 w-3" /> info@spirecut.de
            </a>
            <a href="tel:+4989462599370" className="flex items-center gap-1.5 hover:text-primary transition-colors">
              <Phone className="h-3 w-3" /> +49 89 4625993 70
            </a>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-3">
              {socials.instagram && (
                <a href={socials.instagram} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                  <Instagram className="h-3.5 w-3.5" />
                </a>
              )}
              {socials.youtube && (
                <a href={socials.youtube} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                  <Youtube className="h-3.5 w-3.5" />
                </a>
              )}
              {socials.linkedin && (
                <a href={socials.linkedin} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                  <Linkedin className="h-3.5 w-3.5" />
                </a>
              )}
              {socials.tiktok && (
                <a href={socials.tiktok} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                  <TikTokIcon className="h-3.5 w-3.5" />
                </a>
              )}
              {socials.facebook && (
                <a href={socials.facebook} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                  <FacebookIcon className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            <LanguageSwitcher />
          </div>
        </div>
      </div>

      {/* Logo row + desktop nav + hamburger */}
      <div className="container mx-auto px-4 lg:px-8 py-4 flex items-center justify-between" ref={menuRef}>
        <Link href="/">
          <img
            src={`${import.meta.env.BASE_URL}spirecut-logo.webp`}
            alt="Spirecut"
            className="h-10 md:h-11 w-auto cursor-pointer object-contain"
          />
        </Link>

        {/* Desktop: icon-box nav (xl and up) */}
        <nav className="hidden xl:flex items-center gap-1.5">
          {PAGE_LINKS.map(({ href, navLabelKey, Icon }) => (
            <Link key={href} href={href}>
              <span className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                location === href
                  ? "bg-primary text-white border-primary shadow-sm"
                  : "text-gray-600 border-gray-200 bg-white hover:border-primary/50 hover:text-primary hover:bg-red-50"
              }`}>
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {t(navLabelKey)}
              </span>
            </Link>
          ))}
        </nav>

        {/* Hamburger button (below xl) */}
        <button
          className="xl:hidden flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 text-gray-600 hover:text-primary hover:border-primary/50 transition-colors"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={t("nav.openMenu")}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        {/* Dropdown menu */}
        {menuOpen && (
          <div className="xl:hidden absolute top-full left-0 right-0 bg-white border-t border-gray-100 shadow-lg z-50">
            <nav className="container mx-auto px-4 py-3 flex flex-col gap-1">
              {PAGE_LINKS.map(({ href, navLabelKey, Icon }) => (
                <Link key={href} href={href}>
                  <span className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                    location === href
                      ? "bg-primary text-white"
                      : "text-gray-700 hover:bg-red-50 hover:text-primary"
                  }`}>
                    <Icon className="h-4 w-4 shrink-0" />
                    {t(navLabelKey)}
                  </span>
                </Link>
              ))}
              <div className="px-4 py-2">
                <LanguageSwitcher />
              </div>
              {(socials.instagram || socials.youtube || socials.linkedin || socials.tiktok || socials.facebook) && (
                <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-4">
                  {socials.instagram && (
                    <a href={socials.instagram} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-primary transition-colors">
                      <Instagram className="h-5 w-5" />
                    </a>
                  )}
                  {socials.youtube && (
                    <a href={socials.youtube} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-primary transition-colors">
                      <Youtube className="h-5 w-5" />
                    </a>
                  )}
                  {socials.linkedin && (
                    <a href={socials.linkedin} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-primary transition-colors">
                      <Linkedin className="h-5 w-5" />
                    </a>
                  )}
                  {socials.tiktok && (
                    <a href={socials.tiktok} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-primary transition-colors">
                      <TikTokIcon className="h-5 w-5" />
                    </a>
                  )}
                  {socials.facebook && (
                    <a href={socials.facebook} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-primary transition-colors">
                      <FacebookIcon className="h-5 w-5" />
                    </a>
                  )}
                </div>
              )}
            </nav>
          </div>
        )}
      </div>

    </header>
  );
}
