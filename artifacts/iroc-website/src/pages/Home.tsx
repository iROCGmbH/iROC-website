import { useLanguage } from '@/contexts/LanguageContext';
import { useWebsiteSettings } from '@/hooks/useWebsiteSettings';
import TeamSection from '@/components/TeamSection';
import { AppDownloadSection } from '@/components/AppDownloadSection';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { ArrowRight, CheckCircle2, Lightbulb, Star, Target, ShieldCheck, GraduationCap, Megaphone, Hand, Leaf, Zap } from 'lucide-react';
import spirecutLogo from '@assets/Spirecut_Logo_no_bg_1784563396698.JPG';
import ministemImg from '@assets/MiniStem_1784563417154.png';
import seal1 from '@assets/Siegel_2-removebg-preview_1784563396361.png';
import seal2 from '@assets/Siegel_4-1-removebg-preview_1784563396399.png';
import sealCE from '@assets/Siegel_CEmark-removebg-preview_1784563396448.png';
import sealPatent from '@assets/Siegel_Spirecut_Logo_Patented-removebg-preview_1784563396621.png';

export default function Home() {
  const { t } = useLanguage();
  const ws = useWebsiteSettings();

  return (
    <div className="flex flex-col w-full">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-primary py-24 md:py-36 lg:py-48 text-white">
        <div className="absolute inset-0 z-0 opacity-10 bg-cover bg-center mix-blend-overlay" style={{ backgroundImage: `url('${ws.ws_hero_image_url}')` }}></div>
        <div className="absolute inset-0 z-0 bg-gradient-to-r from-primary to-primary/80"></div>
        
        <div className="container relative z-10 mx-auto px-4 max-w-5xl text-center">
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-8">
            <span className="block text-primary-foreground/90 mb-2">{t('Innovative & Regenerative', 'Innovative & Regenerative')}</span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-blue-200">
              {t('Orthopädische Lösungen', 'Orthopedic Solutions')}
            </span>
          </h1>
          <p className="text-lg md:text-xl text-primary-foreground/80 max-w-2xl mx-auto mb-4 leading-relaxed">
            {t(
              'Innovative Medizinprodukte und praxisnahe Schulungen von erfahrenen Spezialisten.',
              'Innovative medical products and practical training from experienced specialists.'
            )}
          </p>
          <p className="text-base md:text-lg text-primary-foreground/60 max-w-2xl mx-auto mb-10 leading-relaxed italic">
            {t(
              'Die Lücke zwischen innovativer Technologie und klinischer Praxis schließen – durch das Prinzip „Ärzte schulen Ärzte".',
              "Bridging the gap between innovative technology and clinical practice through a 'doctors training doctors' model."
            )}
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 text-base h-14 px-8 rounded-full">
              <Link href="/spirecut">Spirecut® {t('Entdecken', 'Discover')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10 text-base h-14 px-8 rounded-full">
              <Link href="/ministem">MiniStem® {t('Entdecken', 'Discover')}</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Trust Badges */}
      <section className="py-12 bg-white border-b">
        <div className="container mx-auto px-4">
          <p className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-8">
            {t('Zertifizierte Qualität & Innovation', 'Certified Quality & Innovation')}
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16 opacity-70 grayscale hover:grayscale-0 transition-all duration-500">
            <img src={sealCE} alt="CE Mark" className="h-12 md:h-16 object-contain" />
            <img src={sealPatent} alt="Patented" className="h-12 md:h-16 object-contain" />
            <img src={seal1} alt="Quality Seal 1" className="h-12 md:h-16 object-contain" />
            <img src={seal2} alt="Quality Seal 2" className="h-12 md:h-16 object-contain" />
          </div>
        </div>
      </section>

      {/* Products Showcase */}
      <section className="py-24 bg-muted/30">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('Unser Portfolio', 'Our Portfolio')}</h2>
            <div className="w-24 h-1 bg-primary mx-auto"></div>
          </div>

          {/* Product Cards */}
          <div className="grid md:grid-cols-2 gap-12 lg:gap-16 mb-12">
            {/* Spirecut Card */}
            <Link href="/spirecut" className="group flex flex-col bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border">
              <div className="h-64 bg-slate-50 flex items-center justify-center p-8">
                <img src={spirecutLogo} alt="Spirecut" className="max-h-full object-contain mix-blend-multiply group-hover:scale-105 transition-transform duration-500" />
              </div>
              <div className="p-8 md:p-10 flex flex-col flex-1">
                <h3 className="text-2xl font-bold mb-3">Spirecut®</h3>
                <p className="text-muted-foreground mb-6 flex-1">
                  {t(
                    'Ultraschallgesteuerte minimalinvasive Handchirurgie-Instrumente. Keine Hautinzision, sofortige Rückkehr zur Aktivität.',
                    'Ultrasound-guided minimally invasive hand surgery instruments. No skin incision, immediate return to activity.'
                  )}
                </p>
                <ul className="space-y-2 mb-8 text-sm font-medium">
                  <li className="flex items-center gap-2"><CheckCircle2 className="text-primary w-5 h-5" /> Trigger Finger Sono-Instrument®</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="text-primary w-5 h-5" /> Carpal Tunnel Sono-Instrument®</li>
                </ul>
                <div className="text-primary font-semibold flex items-center gap-2 group-hover:gap-3 transition-all">
                  {t('Mehr erfahren', 'Learn more')} <ArrowRight className="w-5 h-5" />
                </div>
              </div>
            </Link>

            {/* MiniStem Card */}
            <Link href="/ministem" className="group flex flex-col bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border">
              <div className="h-64 bg-slate-50 flex items-center justify-center p-8">
                <img src={ministemImg} alt="MiniStem" className="max-h-full object-contain group-hover:scale-105 transition-transform duration-500" />
              </div>
              <div className="p-8 md:p-10 flex flex-col flex-1">
                <h3 className="text-2xl font-bold mb-3">MiniStem®</h3>
                <p className="text-muted-foreground mb-6 flex-1">
                  {t(
                    'Point-of-Care regenerative Medizin. Microfat/SVF Stammzelltherapie für orthopädische Behandlungen direkt in der Praxis.',
                    'Point-of-care regenerative medicine. Microfat/SVF stem cell therapy for orthopedic treatments directly in the practice.'
                  )}
                </p>
                <ul className="space-y-2 mb-8 text-sm font-medium">
                  <li className="flex items-center gap-2"><CheckCircle2 className="text-primary w-5 h-5" /> {t('Regenerative Orthobiologie', 'Regenerative Orthobiology')}</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="text-primary w-5 h-5" /> {t('Point-of-Care Therapie', 'Point-of-Care Therapy')}</li>
                </ul>
                <div className="text-primary font-semibold flex items-center gap-2 group-hover:gap-3 transition-all">
                  {t('Mehr erfahren', 'Learn more')} <ArrowRight className="w-5 h-5" />
                </div>
              </div>
            </Link>
          </div>

          {/* Service Cards */}
          <div className="grid md:grid-cols-2 gap-12 lg:gap-16">
            {/* Post-Training Support */}
            <Link href="/order?service=support" className="group flex flex-col bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border">
              <div className="h-40 bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                <div className="w-20 h-20 rounded-2xl bg-primary/10 group-hover:bg-primary/20 transition-colors flex items-center justify-center">
                  <GraduationCap className="w-10 h-10 text-primary" />
                </div>
              </div>
              <div className="p-8 md:p-10 flex flex-col flex-1">
                <h3 className="text-xl font-bold mb-3">
                  {t('Post-Training Support & Begleitung', 'Post-Training Support and Guidance')}
                </h3>
                <p className="text-muted-foreground mb-6 flex-1 text-sm leading-relaxed">
                  {t(
                    'Kontinuierliche Unterstützung des medizinischen Fachpersonals für die sichere und effiziente Integration neuer Medizintechnologien und -methoden in den klinischen Alltag.',
                    'Continuous support for medical staff to ensure the safe and efficient integration of new medical technologies and methods into their daily clinical routine.'
                  )}
                </p>
                <div className="text-primary font-semibold flex items-center gap-2 group-hover:gap-3 transition-all text-sm">
                  {t('Jetzt anfragen', 'Contact us')} <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>

            {/* Practice Marketing Support */}
            <Link href="/order?service=marketing" className="group flex flex-col bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border">
              <div className="h-40 bg-gradient-to-br from-blue-50 to-sky-50 flex items-center justify-center">
                <div className="w-20 h-20 rounded-2xl bg-blue-100 group-hover:bg-blue-200 transition-colors flex items-center justify-center">
                  <Megaphone className="w-10 h-10 text-primary" />
                </div>
              </div>
              <div className="p-8 md:p-10 flex flex-col flex-1">
                <h3 className="text-xl font-bold mb-3">
                  {t('Praxis-Marketing Support', 'Practice Marketing Support')}
                </h3>
                <p className="text-muted-foreground mb-6 flex-1 text-sm leading-relaxed">
                  {t(
                    'Bereitstellung individueller Werbematerialien, wie personalisierte Flyer mit Praxislogo, damit Mediziner neue Behandlungen ihren Patienten vorstellen können.',
                    'Provision of customized promotional materials, such as personalized flyers with practice logos, to help medical professionals market new treatments to their patients.'
                  )}
                </p>
                <div className="text-primary font-semibold flex items-center gap-2 group-hover:gap-3 transition-all text-sm">
                  {t('Jetzt anfragen', 'Contact us')} <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Treatment Areas — keyword-rich section for SEO */}
      <section className="py-24 bg-white">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              {t('Behandlungsgebiete', 'Areas of Expertise')}
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              {t('Innovative & Regenerative Therapien', 'Innovative & Regenerative Therapies')}
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {t(
                'Von ultraschallgesteuerter minimalinvasiver Handchirurgie bis zur regenerativen Orthobiologie – iROC GmbH bietet innovative Lösungen für ein breites Spektrum orthopädischer Beschwerden.',
                'From ultrasound-guided minimally invasive hand surgery to regenerative orthobiology — iROC GmbH offers innovative solutions for a wide spectrum of orthopaedic conditions.'
              )}
            </p>
            <div className="w-24 h-1 bg-primary mx-auto mt-6" />
          </div>

          {/* Spirecut Indications */}
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Hand className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-xl font-bold">
                  Spirecut® — {t('Minimalinvasive Handchirurgie', 'Minimally Invasive Hand Surgery')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('Ultraschallgesteuert · Keine Hautinzision · Sofortige Rückkehr zur Aktivität', 'Ultrasound-guided · No skin incision · Immediate return to activity')}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                {
                  de: 'Karpal-Tunnel-Syndrom (KTS / CTS)',
                  en: 'Carpal Tunnel Syndrome (KTS / CTS)',
                  detail_de: 'Ultraschallgesteuerte Dekompression des Nervus medianus beim Karpal-Tunnel-Syndrom – minimalinvasiv ohne offene Schnittführung.',
                  detail_en: 'Ultrasound-guided decompression of the median nerve in carpal tunnel syndrome — minimally invasive without open incision.',
                },
                {
                  de: 'Trigger Finger / Schnappfinger (TF / SF)',
                  en: 'Trigger Finger / Snap Finger (TF / SF)',
                  detail_de: 'Behandlung des Schnappfingers (Trigger Finger, TF, SF) ultraschallgesteuert ohne offene Schnittführung, sofortige Funktionsverbesserung.',
                  detail_en: 'Treatment of trigger finger (snap finger, TF, SF) under ultrasound guidance without open surgery, with immediate functional improvement.',
                },
                {
                  de: 'Handschmerzen & Sehnenerkrankungen',
                  en: 'Hand Pain & Tendon Disorders',
                  detail_de: 'Minimalinvasive Behandlung von Handschmerzen, Sehnenstenosen und funktionellen Handeinschränkungen.',
                  detail_en: 'Minimally invasive treatment of hand pain, tendon stenosis and functional hand impairments.',
                },
              ].map((item) => (
                <div key={item.en} className="bg-muted/40 rounded-xl p-6 border hover:border-primary/40 hover:bg-primary/5 transition-colors group">
                  <CheckCircle2 className="w-5 h-5 text-primary mb-3 group-hover:scale-110 transition-transform" />
                  <h4 className="font-semibold mb-2 text-sm leading-snug">{t(item.de, item.en)}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t(item.detail_de, item.detail_en)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* MiniStem Regenerative Indications */}
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                <Leaf className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold">
                  MiniStem® — {t('Regenerative Orthobiologie & Longevity', 'Regenerative Orthobiology & Longevity')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('Point-of-Care · Stammzellen · MFAT · SVF · PRP', 'Point-of-Care · Stem Cells · MFAT · SVF · PRP')}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                {
                  de: 'PRP – Platelet-Rich Plasma',
                  en: 'PRP – Platelet-Rich Plasma',
                  detail_de: 'Regenerative Behandlung mit thrombozytenreichem Plasma (PRP) zur Unterstützung der körpereigenen Heilungsprozesse bei orthopädischen Beschwerden.',
                  detail_en: 'Regenerative treatment with platelet-rich plasma (PRP) to support the body\'s own healing processes in orthopaedic conditions.',
                },
                {
                  de: 'MFAT – Microfat & SVF Stammzelltherapie',
                  en: 'MFAT – Microfat & SVF Stem Cell Therapy',
                  detail_de: 'Point-of-Care Stammzelltherapie mit Microfat (MFAT) und Stromal Vascular Fraction (SVF) – direkt in der Praxis, ohne Laborversand.',
                  detail_en: 'Point-of-care stem cell therapy with microfat (MFAT) and stromal vascular fraction (SVF) — processed directly in-practice, no laboratory shipping required.',
                },
                {
                  de: 'Arthrose & Arthritis',
                  en: 'Osteoarthritis & Arthritis',
                  detail_de: 'Regenerative Behandlung von Arthrose und Arthritis durch Orthobiologie – Förderung der Geweberegeneration statt rein symptomatischer Therapie.',
                  detail_en: 'Regenerative treatment of osteoarthritis and arthritis through orthobiology — promoting tissue regeneration rather than purely symptomatic therapy.',
                },
                {
                  de: 'Orthobiologie',
                  en: 'Orthobiology',
                  detail_de: 'Regenerative Orthobiologie nutzt biologische Wirkstoffe (Stammzellen, Wachstumsfaktoren, PRP, MFAT, SVF) zur Heilung muskuloskelettaler Erkrankungen.',
                  detail_en: 'Regenerative orthobiology uses biological agents (stem cells, growth factors, PRP, MFAT, SVF) to heal musculoskeletal disorders.',
                },
                {
                  de: 'Longevity & Präventionsmedizin',
                  en: 'Longevity & Preventive Medicine',
                  detail_de: 'Longevity-orientierte regenerative Medizin zur Verlangsamung altersbedingter Gelenkdegeneration und Förderung langfristiger Gesundheit.',
                  detail_en: 'Longevity-oriented regenerative medicine to slow age-related joint degeneration and promote long-term musculoskeletal health.',
                },
                {
                  de: 'Regeneration & Innovation',
                  en: 'Regeneration & Innovation',
                  detail_de: 'iROC steht für Innovation in der Regeneration: modernste Medizinprodukte verbinden klinische Evidenz mit maximalem Patientennutzen.',
                  detail_en: 'iROC stands for innovation in regeneration: cutting-edge medical devices combine clinical evidence with maximum patient benefit.',
                },
              ].map((item) => (
                <div key={item.en} className="bg-emerald-50/50 rounded-xl p-6 border border-emerald-100 hover:border-emerald-300 hover:bg-emerald-50 transition-colors group">
                  <Zap className="w-5 h-5 text-emerald-600 mb-3 group-hover:scale-110 transition-transform" />
                  <h4 className="font-semibold mb-2 text-sm leading-snug">{t(item.de, item.en)}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t(item.detail_de, item.detail_en)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Doctors Training Doctors */}
      <section className="py-24 bg-[#002E56] text-white">
        <div className="container mx-auto px-4 max-w-5xl">

          {/* Heading */}
          <div className="text-center mb-14">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-300 mb-3">
              {t('Unser Ansatz', 'Our Approach')}
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-5">
              Doctors Training Doctors
            </h2>
            <div className="w-16 h-[3px] bg-[#0070C0] mx-auto" />
          </div>

          {/* Body paragraphs */}
          <div className="max-w-3xl mx-auto space-y-6 text-white/80 text-base md:text-lg leading-relaxed text-center mb-14">
            <p>
              {t(
                'iROC positioniert sich als spezialisierter medizinischer Anbieter, der die Lücke zwischen innovativer Technologie und klinischer Praxis überbrückt. Durch das Konzept „Ärzte schulen Ärzte" etablieren wir Autorität und bieten erstklassige, mikroinvasive Lösungen, die die Patientenerholung verbessern und die Praxiseffizienz steigern.',
                'iROC positions itself as a specialized medical provider bridging the gap between innovative technology and clinical practice. By using a \'doctors training doctors\' model, we establish authority while offering premium, micro-invasive solutions that improve patient recovery and practice efficiency.'
              )}
            </p>
            <p>
              {t(
                'Unser praxisorientierter Ansatz stellt sicher, dass qualitativ hochwertige, ergonomisch getestete Behandlungen effektiv in den klinischen Alltag integriert werden – für bessere Patientenergebnisse.',
                'Our practical approach ensures that high-quality, ergo-tested treatments are effectively integrated into daily clinical routines for better patient outcomes.'
              )}
            </p>
          </div>

          {/* Values */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-14">
            {[
              { icon: <Lightbulb className="w-6 h-6" />, de: 'Innovation',        en: 'Innovation' },
              { icon: <Star        className="w-6 h-6" />, de: 'Hohe Qualität',    en: 'High Quality' },
              { icon: <Target      className="w-6 h-6" />, de: 'Praxisrelevanz',   en: 'Practical Relevance' },
              { icon: <ShieldCheck className="w-6 h-6" />, de: 'Zuverlässigkeit',  en: 'Reliability' },
            ].map(({ icon, de, en }) => (
              <div
                key={en}
                className="flex flex-col items-center gap-3 bg-white/5 hover:bg-white/10 transition-colors rounded-2xl px-6 py-8 border border-white/10"
              >
                <span className="text-[#0070C0]">{icon}</span>
                <span className="font-semibold text-sm md:text-base text-center">{t(de, en)}</span>
              </div>
            ))}
          </div>

          {/* Tagline */}
          <p className="text-center text-blue-300 font-medium tracking-wide italic text-sm md:text-base">
            iROC – Innovative &amp; Regenerative medical Oriented Consultation
          </p>

        </div>
      </section>

      {/* App Download Section */}
      <AppDownloadSection />

      {/* Team Section */}
      <TeamSection />
    </div>
  );
}
