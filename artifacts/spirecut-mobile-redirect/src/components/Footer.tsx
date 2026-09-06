import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { PAGE_LINKS } from "@/config/navLinks";
import { useSpirecutSettings } from "@/hooks/useSpirecutSettings";

export function Footer() {
  const { t } = useTranslation();
  const sp = useSpirecutSettings();

  const LEGAL = [
    { href: "/impressum", labelKey: "footer.links.impressum" },
    { href: "/datenschutz", labelKey: "footer.links.datenschutz" },
  ];

  return (
    <footer className="border-t border-[#e8ded2] bg-[#fbf6ee] pt-14 pb-8">
      <div className="container mx-auto px-4 lg:px-8">
        <div className="grid grid-cols-1 gap-10 mb-12 md:grid-cols-3">
          {/* Brand */}
          <div>
            <img
              src={`${import.meta.env.BASE_URL}spirecut-logo.webp`}
              alt="Spirecut"
              className="h-8 w-auto mb-5 object-contain object-left"
            />
            <p className="text-sm text-foreground/55 leading-relaxed mb-1">
              Hofackerstrasse 40B<br />
              CH – 4132 Muttenz<br />
              CHE-209.831.310
            </p>
            <p className="text-sm text-foreground/55 mt-3">
              <a href="tel:+41265051838" className="hover:text-primary transition-colors">+41 26 505 18 38</a><br />
              <a href={`mailto:${sp.sp_contact_email_com}`} className="hover:text-primary transition-colors">{sp.sp_contact_email_com}</a>
            </p>
          </div>

          {/* Pages */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/40 mb-4">{t("footer.pages")}</h4>
            <ul className="space-y-2.5">
              {PAGE_LINKS.map(({ href, footerLabelKey }) => (
                <li key={href}>
                  <Link href={href}>
                    <span className="text-sm text-foreground/65 hover:text-primary transition-colors cursor-pointer">{t(footerLabelKey)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal + Contact */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/40 mb-4">{t("footer.legal")}</h4>
            <ul className="space-y-2.5 mb-8">
              {LEGAL.map((p) => (
                <li key={p.href}>
                  <Link href={p.href}>
                    <span className="text-sm text-foreground/65 hover:text-primary transition-colors cursor-pointer">{t(p.labelKey)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground/40 mb-4">{t("footer.sales")}</h4>
            <p className="text-sm text-foreground/55 leading-relaxed">
              iROC GmbH<br />
              St.-Emmeram-Str. 26<br />
              85609 Aschheim<br />
              <a href={`mailto:${sp.sp_contact_email_de}`} className="hover:text-primary transition-colors">{sp.sp_contact_email_de}</a>
            </p>
          </div>
        </div>

        {/* Seals */}
        <div className="border-t border-[#e8ded2] pt-8 flex flex-col md:flex-row justify-between items-center gap-6">
          <p className="text-xs text-foreground/40">{t("footer.copyright", { year: new Date().getFullYear() })}</p>
          <div className="flex items-center gap-5 flex-wrap justify-center">
            <img src={`${import.meta.env.BASE_URL}siegel-swiss.png`} alt={t("footer.certificates.swiss")} className="h-12 object-contain grayscale hover:grayscale-0 transition-all duration-300 opacity-70 hover:opacity-100" />
            <img src={`${import.meta.env.BASE_URL}siegel-fda.png`} alt={t("footer.certificates.fda")} className="h-12 object-contain grayscale hover:grayscale-0 transition-all duration-300 opacity-70 hover:opacity-100" />
            <img src={`${import.meta.env.BASE_URL}siegel-ce.png`} alt={t("footer.certificates.ce")} className="h-10 object-contain grayscale hover:grayscale-0 transition-all duration-300 opacity-70 hover:opacity-100" />
            <img src={`${import.meta.env.BASE_URL}siegel-iso.png`} alt={t("footer.certificates.iso")} className="h-12 object-contain grayscale hover:grayscale-0 transition-all duration-300 opacity-70 hover:opacity-100" />
            <img src={`${import.meta.env.BASE_URL}siegel-patented.png`} alt={t("footer.certificates.patented")} className="h-12 object-contain grayscale hover:grayscale-0 transition-all duration-300 opacity-70 hover:opacity-100" />
          </div>
        </div>
      </div>
    </footer>
  );
}
