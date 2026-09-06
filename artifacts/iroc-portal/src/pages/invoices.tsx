import { useState } from 'react';
import { useListPortalInvoices, getListPortalInvoicesQueryKey } from '@workspace/api-client-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Layout } from '@/components/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import {
  Download, FileText, CheckCircle2, Clock, XCircle,
  TrendingUp,
} from 'lucide-react';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription, EmptyHeader } from '@/components/ui/empty';

type InvoiceStatus = 'all' | 'sent' | 'paid' | 'cancelled';

const fmt = (amount: number, lang: string = 'DE') =>
  amount.toLocaleString(lang === 'DE' ? 'de-DE' : 'en-GB', { style: 'currency', currency: 'EUR' });

export default function Invoices() {
  const { token } = useAuth();
  const { data: invoices, isLoading, error } = useListPortalInvoices({
    query: { enabled: !!token, queryKey: getListPortalInvoicesQueryKey() },
  });
  const { language, t } = useLanguage();
  const [activeFilter, setActiveFilter] = useState<InvoiceStatus>('all');

  const formatDate = (ds: string) => {
    try {
      const locale = language === 'DE' ? 'de-DE' : 'en-GB';
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(ds));
    } catch { return ds; }
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'paid':
        return { icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: 'text-emerald-600 bg-emerald-50', label: t('Bezahlt', 'Paid') };
      case 'sent':
        return { icon: <Clock className="w-3.5 h-3.5" />, color: 'text-amber-600 bg-amber-50', label: t('Ausstehend', 'Pending') };
      case 'cancelled':
        return { icon: <XCircle className="w-3.5 h-3.5" />, color: 'text-slate-500 bg-slate-100', label: t('Storniert', 'Cancelled') };
      default:
        return { icon: null, color: 'text-slate-500 bg-slate-100', label: status };
    }
  };

  const handleDownload = async (id: number) => {
    try {
      const res = await fetch(`/api/portal/invoices/${id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore network errors
    }
  };

  const all = invoices ?? [];
  const sumOf = (list: typeof all) => list.reduce((acc, inv) => acc + (inv.totalAmount ?? 0), 0);
  const groups: Record<InvoiceStatus, typeof all> = {
    all,
    sent:      all.filter(i => i.status === 'sent'),
    paid:      all.filter(i => i.status === 'paid'),
    cancelled: all.filter(i => i.status === 'cancelled'),
  };
  const filtered = groups[activeFilter];

  return (
    <Layout title={t('Dokumente', 'Documents')}>
      <div className="mb-6">
        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">{t('Rechnungen', 'Invoices')}</h2>
        <p className="text-slate-500 mt-1 font-medium">
          {t('Verlauf einsehen und PDFs herunterladen.', 'View history and download PDFs.')}
        </p>
      </div>

      {/* Segmented Control for Filters */}
      {!isLoading && !error && all.length > 0 && (
        <div className="overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide">
          <div className="flex gap-2 w-max">
            {(['all', 'sent', 'paid', 'cancelled'] as InvoiceStatus[]).map(key => {
              const isActive = activeFilter === key;
              const count = groups[key].length;
              const label = key === 'all' ? t('Alle', 'All')
                        : key === 'sent' ? t('Offen', 'Pending')
                        : key === 'paid' ? t('Bezahlt', 'Paid')
                        : t('Storniert', 'Cancelled');

              if (count === 0 && key !== 'all') return null;

              return (
                <button
                  key={key}
                  onClick={() => setActiveFilter(key)}
                  className={`px-4 py-2 rounded-full text-sm font-bold transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-primary text-white shadow-md shadow-primary/20'
                      : 'bg-white text-slate-600 border border-slate-200'
                  }`}
                >
                  {label} <span className={`ml-1 px-1.5 py-0.5 rounded-md text-[10px] ${isActive ? 'bg-white/20' : 'bg-slate-100'}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Outstanding balance callout */}
      {!isLoading && !error && groups.sent.length > 0 && (activeFilter === 'all' || activeFilter === 'sent') && (
        <div className="mb-6 flex items-center justify-between p-5 rounded-3xl bg-amber-50 border border-amber-100">
          <div>
            <div className="flex items-center gap-2 text-amber-800 font-bold text-sm mb-1">
              <TrendingUp className="w-4 h-4" />
              {t('Offener Betrag', 'Outstanding')}
            </div>
            <p className="text-2xl font-extrabold text-amber-900 tracking-tight">
              {fmt(sumOf(groups.sent), language)}
            </p>
          </div>
          <div className="text-right">
            <span className="text-amber-700 font-bold bg-amber-200/50 px-3 py-1 rounded-lg text-sm">
              {groups.sent.length} {t('offen', 'pending')}
            </span>
          </div>
        </div>
      )}

      {/* Invoice list */}
      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-3xl" />)
        ) : error ? (
          <Empty className="bg-white rounded-3xl border-slate-100 shadow-sm">
            <EmptyHeader>
              <EmptyMedia variant="icon"><FileText /></EmptyMedia>
              <EmptyTitle>{t('Fehler', 'Error')}</EmptyTitle>
              <EmptyDescription>{t('Bitte später erneut versuchen.', 'Please try again later.')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty className="bg-white rounded-3xl border-slate-100 shadow-sm">
            <EmptyHeader>
              <EmptyMedia variant="icon"><FileText /></EmptyMedia>
              <EmptyTitle>{t('Keine Rechnungen', 'No invoices')}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          filtered.map(invoice => {
            const status = getStatusDisplay(invoice.status);
            const invoiceNotes = invoice.notes ?? "";
            const correctionReference = /^(?:Rechnungskorrektur|Invoice correction)\b/i.test(invoiceNotes)
              ? invoiceNotes.split("\n")[0]
              : null;
            return (
              <div
                key={invoice.id}
                className="bg-white rounded-3xl p-4 sm:p-5 shadow-sm border border-slate-100 flex flex-col gap-4 active:scale-[0.99] transition-transform"
              >
                <div className="flex items-start justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="font-extrabold text-lg text-slate-900 tracking-tight">{invoice.invoiceNumber}</span>
                    <span className="text-sm font-medium text-slate-500">{formatDate(invoice.issueDate)}</span>
                    {correctionReference && (
                      <span className="text-xs font-semibold text-violet-700">{correctionReference}</span>
                    )}
                  </div>
                  <div className="text-right flex flex-col items-end gap-2">
                    {invoice.totalAmount !== undefined && (
                      <span className="font-extrabold text-lg text-slate-900 tracking-tight">
                        {fmt(invoice.totalAmount, language)}
                      </span>
                    )}
                    <span className={`flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${status.color}`}>
                      {status.icon}
                      {status.label}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleDownload(invoice.id)}
                  className="flex items-center justify-center gap-2 w-full h-12 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold rounded-2xl transition-colors text-sm"
                >
                  <Download className="w-4 h-4" />
                  {t('PDF speichern', 'Save PDF')}
                </button>
              </div>
            );
          })
        )}
      </div>
    </Layout>
  );
}
