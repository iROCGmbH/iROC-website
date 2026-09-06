import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Video, AlertCircle } from 'lucide-react';

interface Testimonial {
  id: number;
  titleDe: string;
  titleEn: string;
  descriptionDe: string;
  descriptionEn: string;
  patientLabel: string;
  procedureDe: string;
  procedureEn: string;
  videoUrl: string;
  displayOrder: number;
  published: boolean;
}

function getYouTubeEmbedUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const youtubeHosts = new Set([
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtube-nocookie.com',
      'www.youtube-nocookie.com',
    ]);
    let videoId: string | null = null;

    if (host === 'youtu.be' || host === 'www.youtu.be') {
      videoId = parsed.pathname.split('/').filter(Boolean)[0] ?? null;
    } else if (youtubeHosts.has(host) && parsed.pathname === '/watch') {
      videoId = parsed.searchParams.get('v');
    } else if (youtubeHosts.has(host)) {
      const [first, id] = parsed.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(first ?? '')) videoId = id ?? null;
    }

    if (videoId && /^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
      return `https://www.youtube-nocookie.com/embed/${videoId}`;
    }
  } catch {
    // ignore
  }
  return null;
}

export default function PatientTestimonials() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetch('/api/patient-testimonials')
      .then((res) => {
        if (!res.ok) throw new Error('Fetch failed');
        return res.json();
      })
      .then((data) => {
        // Double check they are published, even though server should filter
        const published = (data || []).filter((item: Testimonial) => item.published);
        setItems(published);
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const lang = i18n.language.startsWith('de') ? 'de' : 'en';
  const visibleItems = items.flatMap((item) => {
    const embedUrl = getYouTubeEmbedUrl(item.videoUrl);
    return embedUrl ? [{ item, embedUrl }] : [];
  });

  return (
    <div className="min-h-screen bg-gray-50/50 pb-24">
      {/* Hero Section */}
      <section className="bg-white border-b border-gray-200 py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-8 max-w-4xl text-center">
          <div className="inline-flex items-center justify-center p-3 bg-red-50 rounded-full mb-6 text-primary">
            <Video className="w-6 h-6" />
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-gray-900 mb-6">
            {t('testimonials.heroTitle', 'Patientenerfahrungen')}
          </h1>
          <p className="text-lg md:text-xl text-gray-600 leading-relaxed max-w-2xl mx-auto">
            {t('testimonials.heroDesc', 'Erfahren Sie aus erster Hand, wie Patienten den Eingriff und die Genesung erlebt haben.')}
          </p>
        </div>
      </section>

      {/* Content Section */}
      <section className="container mx-auto px-4 md:px-8 py-16 max-w-5xl">
        {loading ? (
          <div className="flex justify-center py-20">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <div className="bg-red-50 text-red-800 p-6 rounded-2xl flex flex-col items-center justify-center text-center max-w-lg mx-auto">
            <AlertCircle className="w-10 h-10 mb-4 text-red-500" />
            <p className="font-medium text-lg mb-2">
              {t('testimonials.error', 'Fehler beim Laden der Erfahrungsberichte.')}
            </p>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="bg-white border border-gray-100 p-12 rounded-2xl text-center max-w-2xl mx-auto shadow-sm">
            <Video className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              {t('testimonials.empty', 'Derzeit sind noch keine Erfahrungsberichte verfügbar.')}
            </h3>
          </div>
        ) : (
          <div className="grid gap-10 md:gap-16">
            {visibleItems.map(({ item, embedUrl }) => {
              const title = lang === 'de' ? item.titleDe : item.titleEn;
              const description = lang === 'de' ? item.descriptionDe : item.descriptionEn;

              return (
                <article key={item.id} className="bg-white border border-gray-100 rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col lg:flex-row group">
                  {/* Video Player */}
                  <div className="w-full lg:w-[55%] aspect-video bg-gray-900 relative shrink-0">
                    <iframe
                      src={embedUrl}
                      title={title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="absolute inset-0 w-full h-full border-0"
                      loading="lazy"
                    />
                  </div>

                  {/* Content */}
                  <div className="p-6 md:p-10 flex flex-col justify-center flex-1">
                    {/* Metadata tags */}
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                       {(lang === 'de' ? item.procedureDe : item.procedureEn) && (
                        <span className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold tracking-wide uppercase">
                           {lang === 'de' ? item.procedureDe : item.procedureEn}
                        </span>
                      )}
                    </div>
                    
                    <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4 group-hover:text-primary transition-colors">
                      {title}
                    </h2>
                    
                    {description && (
                      <p className="text-gray-600 leading-relaxed mb-6">
                        {description}
                      </p>
                    )}

                    {item.patientLabel && (
                      <div className="mt-auto pt-6 border-t border-gray-100 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-red-50 text-primary flex items-center justify-center font-bold shadow-sm shrink-0">
                          {item.patientLabel.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-0.5">
                            {t('testimonials.patientLabel', 'Patient')}
                          </p>
                          <p className="text-sm font-semibold text-gray-900">
                            {item.patientLabel}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
