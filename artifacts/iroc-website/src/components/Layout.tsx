import { useLanguage } from '@/contexts/LanguageContext';
import { Navigation } from './Navigation';
import { Link } from 'wouter';
import logoMark from '../assets/logo-iroc.png';
import { useWebsiteSettings } from '@/hooks/useWebsiteSettings';
import { Linkedin, Facebook, Instagram, Youtube } from 'lucide-react';
import { footerLinks } from '@/config/navLinks';
import { MedicalGate } from './MedicalGate';

export function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const ws = useWebsiteSettings();

  const socials = [
    { key: 'ws_social_linkedin',  url: ws.ws_social_linkedin,  Icon: Linkedin,  label: 'LinkedIn'  },
    { key: 'ws_social_facebook',  url: ws.ws_social_facebook,  Icon: Facebook,  label: 'Facebook'  },
    { key: 'ws_social_instagram', url: ws.ws_social_instagram, Icon: Instagram, label: 'Instagram' },
    { key: 'ws_social_youtube',   url: ws.ws_social_youtube,   Icon: Youtube,   label: 'YouTube'   },
  ].filter((s) => s.url.trim() !== '');

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/20">
      <MedicalGate />
      <Navigation />
      
      <main className="flex-1 w-full">
        {children}
      </main>

      <footer className="bg-primary text-primary-foreground border-t border-primary/20 pt-16 pb-8">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
            <div className="col-span-1 md:col-span-1">
              {/* Footer logo — white mark + white text on navy background */}
              <div className="flex flex-col items-start gap-1.5 mb-6">
                <img
                  src={ws.ws_logo_url || logoMark}
                  alt="iROC"
                  className="h-8 w-auto object-contain brightness-0 invert"
                />
                <span className="text-white font-bold text-sm tracking-wider">
                  iROC GmbH
                </span>
              </div>
              <p className="text-primary-foreground/70 text-sm leading-relaxed max-w-xs">
                {t(
                  'Innovative & Regenerative medical Oriented Consultation. Spezialisiert auf präzise medizinische Instrumente und Schulungen.',
                  'Innovative & Regenerative medical Oriented Consultation. Specialized in precision medical instruments and training.'
                )}
              </p>
            </div>
            
            <div>
              <h4 className="font-semibold text-lg mb-6 text-white tracking-wide">{t('Kontakt', 'Contact')}</h4>
              <address className="not-italic text-primary-foreground/70 text-sm space-y-3">
                <p>iROC GmbH</p>
                <p>{ws.ws_address_street}</p>
                <p>{ws.ws_address_postal} {ws.ws_address_city}, {t(ws.ws_address_country_de, ws.ws_address_country_en)}</p>
                <p className="pt-2"><a href={`mailto:${ws.ws_contact_email}`} className="hover:text-white transition-colors">{ws.ws_contact_email}</a></p>
                <p><a href={`tel:${ws.ws_contact_phone.replace(/\s/g,'')}`} className="hover:text-white transition-colors">{ws.ws_contact_phone}</a></p>
              </address>
              {socials.length > 0 && (
                <div className="flex items-center gap-3 mt-5">
                  {socials.map(({ key, url, Icon, label }) => (
                    <a key={key} href={url} target="_blank" rel="noopener noreferrer" aria-label={label}
                      className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-primary-foreground/70 hover:text-white transition-colors">
                      <Icon className="w-4 h-4" />
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="font-semibold text-lg mb-6 text-white tracking-wide">Seiten / Pages</h4>
              <ul className="text-primary-foreground/70 text-sm space-y-3">
                {footerLinks
                  .filter((l) => l.group === 'flat' || l.group === 'product' || l.group === 'service')
                  .map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="hover:text-white transition-colors">
                        {t(l.labelDE, l.labelEN)}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-lg mb-6 text-white tracking-wide">Rechtliches / Legal</h4>
              <ul className="text-primary-foreground/70 text-sm space-y-3">
                {footerLinks
                  .filter((l) => l.group === 'hidden')
                  .map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="hover:text-white transition-colors">
                        {t(l.labelDE, l.labelEN)}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
          
          <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center text-xs text-primary-foreground/50">
            <p>&copy; {new Date().getFullYear()} iROC GmbH. All rights reserved.</p>
            <p className="mt-2 md:mt-0">Innovative & Regenerative medical Oriented Consultation</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
