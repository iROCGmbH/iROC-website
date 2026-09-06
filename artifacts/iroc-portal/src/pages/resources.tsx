import { useState } from 'react';
import { useListPortalResources, getListPortalResourcesQueryKey } from '@workspace/api-client-react';
import type { PortalResource } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';
import { useLanguage } from '@/contexts/LanguageContext';
import { Layout } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Play, ExternalLink, BookOpen, ChevronRight } from 'lucide-react';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription, EmptyHeader } from '@/components/ui/empty';

type ResourceItem = PortalResource & { instrument?: string | null };

const PRODUCT_LABELS: Record<string, { de: string; en: string }> = {
  spirecut: { de: 'Spirecut®', en: 'Spirecut®' },
  ministem: { de: 'MiniStem® / SVF', en: 'MiniStem® / SVF' },
};

export default function Resources() {
  const { customer, token } = useAuth();
  const { data: resources, isLoading, error } = useListPortalResources({
    query: { enabled: !!token, queryKey: getListPortalResourcesQueryKey() },
  });
  const { language, t } = useLanguage();
  const lang = language === 'DE' ? 'de' : 'en';

  const certifiedInstruments = (() => {
    const certifications = customer?.certifications?.length
      ? customer.certifications
      : customer?.instrument === 'both'
        ? ['spirecut', 'ministem']
        : customer?.instrument
          ? [customer.instrument]
          : [];

    return [...new Set(certifications.map((instrument) =>
      instrument === 'svf' ? 'ministem' : instrument,
    ))];
  })();

  const typedResources = (resources ?? []) as ResourceItem[];

  // Filter state for mobile tabs
  const [activeTab, setActiveTab] = useState<string>(certifiedInstruments[0] || 'all');

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'video':        return t('Video', 'Video');
      case 'presentation': return t('Präs.', 'Pres.');
      case 'study':        return t('Studie', 'Study');
      default:             return type;
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'video': return <Play className="w-3.5 h-3.5" />;
      case 'presentation': return <FileText className="w-3.5 h-3.5" />;
      case 'study': return <FileText className="w-3.5 h-3.5" />;
      default: return <ExternalLink className="w-3.5 h-3.5" />;
    }
  };

  const renderResource = (resource: ResourceItem) => {
    const isYoutube = resource.url.includes('youtube.com') || resource.url.includes('youtu.be');
    let embedUrl: string | null = null;
    if (resource.type === 'video' && isYoutube) {
      const match = resource.url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
      if (match?.[1]) embedUrl = `https://www.youtube.com/embed/${match[1]}`;
    }

    const title = (lang === 'de' ? resource.titleDe : null) || resource.title;
    const description = (lang === 'de' ? resource.descriptionDe : null) || resource.description;

    return (
      <div key={resource.id} className="bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100 mb-4 active:scale-[0.99] transition-transform">
        {resource.type === 'video' && embedUrl ? (
          <div className="aspect-video w-full bg-slate-900 rounded-t-3xl overflow-hidden">
            <iframe
              src={embedUrl}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : resource.thumbnailUrl ? (
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t(`${title} öffnen`, `Open ${title}`)}
            className="aspect-[21/9] w-full bg-slate-100 relative group overflow-hidden block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <img
              src={resource.thumbnailUrl}
              alt={title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
              <div className="w-12 h-12 bg-white/90 backdrop-blur-md rounded-full flex items-center justify-center shadow-lg text-slate-900">
                {getIcon(resource.type)}
              </div>
            </div>
          </a>
        ) : null}

        <div className="p-5 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-bold text-lg leading-tight text-slate-900 line-clamp-2">{title}</h3>
            <Badge variant="secondary" className="shrink-0 bg-slate-100 text-slate-600 font-bold uppercase tracking-wider text-[10px] px-2 py-1 rounded-lg">
              {getTypeLabel(resource.type)}
            </Badge>
          </div>

          {description && (
            <p className="text-slate-500 text-sm line-clamp-2 font-medium">{description}</p>
          )}

          {!(resource.type === 'video' && embedUrl) && (
            <button
              onClick={() => window.open(resource.url, '_blank')}
              className="mt-2 flex items-center justify-between w-full h-12 px-4 bg-slate-50 hover:bg-slate-100 rounded-2xl transition-colors text-sm font-bold text-slate-700"
            >
              <span className="flex items-center gap-2">
                {getIcon(resource.type)}
                {resource.type === 'video'
                  ? t('Video ansehen', 'Watch Video')
                  : t('Dokument öffnen', 'Open Document')}
              </span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const resourceGroups = certifiedInstruments.map(instr => ({
    key: instr,
    label: lang === 'de'
      ? (PRODUCT_LABELS[instr]?.de ?? instr)
      : (PRODUCT_LABELS[instr]?.en ?? instr),
    items: typedResources.filter(
      r => !r.instrument || r.instrument === 'both' || r.instrument === instr,
    ),
  }));

  const activeGroupItems = resourceGroups.find(g => g.key === activeTab)?.items || [];

  return (
    <Layout title={t('Lehrportal', 'Teaching Portal')}>
      <div className="mb-6">
        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">{t('Lehrportal', 'Teaching')}</h2>
        <p className="text-slate-500 mt-1 font-medium">
          {t('Leitlinien, Präsentationen und Videos.', 'Guidelines, presentations, and videos.')}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full rounded-2xl" />
          {[1, 2].map(i => (
            <Skeleton key={i} className="h-64 w-full rounded-3xl" />
          ))}
        </div>
      ) : error ? (
        <Empty className="border-slate-100 bg-white rounded-3xl shadow-sm">
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileText /></EmptyMedia>
            <EmptyTitle>{t('Fehler beim Laden', 'Failed to load resources')}</EmptyTitle>
            <EmptyDescription>{t('Bitte versuchen Sie es später erneut.', 'Please try again later.')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !typedResources.length ? (
        <Empty className="border-slate-100 bg-white rounded-3xl shadow-sm">
          <EmptyHeader>
            <EmptyMedia variant="icon"><BookOpen /></EmptyMedia>
            <EmptyTitle>{t('Keine Materialien', 'No resources')}</EmptyTitle>
            <EmptyDescription>{t('Derzeit sind keine Schulungsmaterialien verfügbar.', 'No training materials available right now.')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-6">
          {/* iOS-style segmented control for instruments if > 1 */}
          {certifiedInstruments.length > 1 && (
            <div className="bg-slate-200/50 p-1 rounded-2xl flex">
              {resourceGroups.map(group => (
                <button
                  key={group.key}
                  onClick={() => setActiveTab(group.key)}
                  className={`flex-1 py-2 text-sm font-bold rounded-xl transition-all ${
                    activeTab === group.key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {group.label}
                </button>
              ))}
            </div>
          )}

          <div>
            {activeGroupItems.length === 0 ? (
              <p className="text-center text-sm font-medium text-slate-400 py-8">
                {t('Keine Materialien für dieses Produkt.', 'No materials for this product.')}
              </p>
            ) : (
              <div>
                {activeGroupItems.map(renderResource)}
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
