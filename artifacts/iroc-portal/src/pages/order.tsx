import { useState, useCallback, useEffect, useRef } from 'react';
import {
  usePortalOrderRequest,
  useListPortalProducts,
  getListPortalProductsQueryKey,
  usePortalMe,
  getPortalMeQueryKey,
} from '@workspace/api-client-react';
import type { PortalProductGroup } from '@workspace/api-client-react';
import { Layout } from '@/components/layout';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { buildPortalOrderProducts, type OrderMode } from '@/lib/order-products';
import {
  Loader2, ShoppingCart, CheckCircle2, Minus, Plus,
  GraduationCap, Megaphone, Package, AlertCircle, ChevronRight, Info,
} from 'lucide-react';

type ServiceType = 'post_training_support' | 'practice_marketing_support';
type Selection = Record<number, number>;

function ElectronicInvoiceNotice({ t }: { t: (de: string, en: string) => string }) {
  return (
    <aside className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
      <div className="space-y-1.5">
        <p className="text-sm font-extrabold">
          {t('Hinweis zur E-Rechnung', 'Information on electronic invoicing')}
        </p>
        <p className="text-xs leading-relaxed text-blue-900/80">
          {t(
            'Für inländische B2B-Umsätze gelten in Deutschland seit dem 1. Januar 2025 neue gesetzliche Regelungen zur elektronischen Rechnung (E-Rechnung). Die Übergangsregelungen laufen grundsätzlich bis zum 31. Dezember 2027. Ab dem 1. Januar 2028 ist die E-Rechnung für inländische B2B-Umsätze grundsätzlich verpflichtend; für Unternehmen mit einem Vorjahresumsatz von mehr als 800.000 € gilt die Ausstellungspflicht bereits ab dem 1. Januar 2027. Wir stellen unsere B2B-Rechnungen bereits heute im gesetzlich vorgesehenen strukturierten elektronischen Format aus. Privatkunden sind von dieser Regelung nicht betroffen.',
            'In Germany, new statutory rules on electronic invoicing for domestic B2B transactions have applied since 1 January 2025. The transitional rules generally run until 31 December 2027. From 1 January 2028, e-invoicing will generally be mandatory for domestic B2B transactions; businesses with prior-year turnover exceeding €800,000 must already issue e-invoices from 1 January 2027. We already issue our B2B invoices in the legally prescribed structured electronic format. This rule does not apply to private consumers.',
          )}
        </p>
      </div>
    </aside>
  );
}

export default function Order() {
  const { t } = useLanguage();
  const { customer } = useAuth();
  const { toast } = useToast();

  const [mode, setMode] = useState<OrderMode>('product');
  const [serviceType, setServiceType] = useState<ServiceType>('post_training_support');
  const [contactName, setContactName] = useState(
    [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || ''
  );
  const [contactEmail, setContactEmail] = useState(customer?.email ?? '');
  const [contactPhone, setContactPhone] = useState(customer?.phone ?? '');
  const [selection, setSelection] = useState<Selection>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [detailsConfirmed, setDetailsConfirmed] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const prefillApplied = useRef(false);

  const { data: portalProfile } = usePortalMe({
    query: { enabled: !!customer, queryKey: getPortalMeQueryKey() },
  });

  const { data: productGroups = [], isLoading: productsLoading } = useListPortalProducts({
    query: { enabled: !!customer, queryKey: getListPortalProductsQueryKey() },
  });

  useEffect(() => {
    if (!portalProfile || prefillApplied.current) return;
    prefillApplied.current = true;
    const hasProfileAddress = Boolean(
      portalProfile.address?.trim()
      || portalProfile.postalCode?.trim()
      || portalProfile.city?.trim(),
    );
    const fallbackAddress = hasProfileAddress
      ? [
        portalProfile.address,
        [portalProfile.postalCode, portalProfile.city].filter(Boolean).join(' '),
        portalProfile.country,
      ].filter(Boolean).join('\n')
      : '';
    setContactPhone(portalProfile.lastOrderPhone ?? portalProfile.phone ?? '');
    setDeliveryAddress(portalProfile.lastOrderDeliveryAddress ?? fallbackAddress);
  }, [portalProfile]);

  const setQty = (productId: number, delta: number, current: number) => {
    const next = Math.max(0, current + delta);
    setDetailsConfirmed(false);
    setSelection(prev => {
      const updated = { ...prev };
      if (next === 0) delete updated[productId];
      else updated[productId] = next;
      return updated;
    });
  };

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const selectedCount = Object.values(selection).filter(q => q > 0).length;

  const orderMutation = usePortalOrderRequest({
    mutation: {
      onSuccess: () => setIsSubmitted(true),
      onError: (error) => {
        toast({
          title: t('Fehler', 'Error'),
          description: error.message || t('Anfrage konnte nicht gesendet werden.', 'Failed to submit request.'),
          variant: 'destructive',
        });
      }
    }
  });

  const canSubmit = privacyConsent && detailsConfirmed
    && contactName.trim().length > 0
    && contactEmail.includes('@')
    && contactPhone.trim().length > 0
    && (
    mode === 'product' ? selectedCount > 0 && deliveryAddress.trim().length > 0 : true
  );

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const products = buildPortalOrderProducts(
      productGroups as PortalProductGroup[],
      selection,
      mode,
    );

    orderMutation.mutate({
      data: {
        orderMode: mode,
        serviceType: mode === 'service' ? serviceType : undefined,
        contactName: contactName.trim() || undefined,
        contactEmail,
        contactPhone: contactPhone.trim(),
        products,
        deliveryAddress: deliveryAddress.trim() || undefined,
        notes: notes.trim() || undefined,
        privacyConsent: true,
        detailsConfirmed: true,
      },
    });
  }, [canSubmit, mode, serviceType, contactName, contactEmail, contactPhone, selection, productGroups, deliveryAddress, notes, orderMutation]);

  const SERVICE_OPTIONS = [
    {
      value: 'post_training_support' as const,
      labelDe: 'Post-Training Support',
      labelEn: 'Post-Training Support',
      icon: <GraduationCap className="w-6 h-6" />,
      color: 'text-blue-600 bg-blue-50 border-blue-200',
    },
    {
      value: 'practice_marketing_support' as const,
      labelDe: 'Praxis-Marketing',
      labelEn: 'Practice Marketing',
      icon: <Megaphone className="w-6 h-6" />,
      color: 'text-orange-600 bg-orange-50 border-orange-200',
    },
  ];

  if (isSubmitted) {
    return (
      <Layout title={t('Bestellen', 'Order')}>
        <div className="pt-16 pb-12 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-6 shadow-sm">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h3 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-3">
            {t('Erfolgreich', 'Success')}
          </h3>
          <p className="text-slate-500 font-medium mb-10 max-w-[280px]">
            {mode === 'product'
              ? t('Ihre Bestellung wird zeitnah bearbeitet.', 'Your order will be processed shortly.')
              : t('Wir melden uns in Kürze.', 'We will be in touch shortly.')}
          </p>
          <Button onClick={() => { setIsSubmitted(false); setSelection({}); setPrivacyConsent(false); setDetailsConfirmed(false); }} className="h-14 px-8 rounded-2xl font-bold text-base shadow-md">
            {t('Neue Anfrage', 'New Request')}
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('Bestellen', 'Order')}>
      <div className="mb-6">
        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">{t('Bestellen', 'Order')}</h2>
        <p className="text-slate-500 mt-1 font-medium">
          {t('Produkte oder Services anfragen.', 'Request products or services.')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 pb-8">
        <ElectronicInvoiceNotice t={t} />

        {/* iOS-style Segmented Control */}
        <div className="bg-slate-200/60 p-1 rounded-2xl flex relative shadow-inner">
          <div
            className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-xl shadow-sm transition-transform duration-300 ease-out"
            style={{ transform: mode === 'product' ? 'translateX(0)' : 'translateX(calc(100% + 8px))' }}
          />
          <button
            type="button"
            onClick={() => { setMode('product'); setDetailsConfirmed(false); }}
            className={`flex-1 py-3 text-sm font-bold rounded-xl relative z-10 transition-colors ${mode === 'product' ? 'text-slate-900' : 'text-slate-500'}`}
          >
            <span className="flex items-center justify-center gap-2">
              <Package className="w-4 h-4" /> {t('Produkte', 'Products')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setMode('service'); setDetailsConfirmed(false); }}
            className={`flex-1 py-3 text-sm font-bold rounded-xl relative z-10 transition-colors ${mode === 'service' ? 'text-slate-900' : 'text-slate-500'}`}
          >
            <span className="flex items-center justify-center gap-2">
              <Megaphone className="w-4 h-4" /> {t('Services', 'Services')}
            </span>
          </button>
        </div>

        {/* Service Type Selection */}
        {mode === 'service' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {SERVICE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { setServiceType(opt.value); setDetailsConfirmed(false); }}
                className={`flex flex-col items-center justify-center gap-3 p-6 rounded-3xl border-2 transition-all active:scale-[0.98] ${
                  serviceType === opt.value
                    ? `border-primary bg-primary/5 shadow-md shadow-primary/10`
                    : `border-slate-100 bg-white shadow-sm`
                }`}
              >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${serviceType === opt.value ? opt.color : 'bg-slate-50 text-slate-400'}`}>
                  {opt.icon}
                </div>
                <span className={`font-bold text-center ${serviceType === opt.value ? 'text-primary' : 'text-slate-600'}`}>
                  {t(opt.labelDe, opt.labelEn)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Product List */}
        {mode === 'product' && (
          <div className="space-y-4">
            {productsLoading ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (productGroups as PortalProductGroup[]).length === 0 ? (
              <div className="bg-amber-50 border border-amber-100 rounded-3xl p-6 text-center">
                <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
                <p className="font-bold text-amber-900">{t('Keine Produkte', 'No products')}</p>
                <p className="text-sm text-amber-700 mt-1">{t('Bitte wenden Sie sich an den Support.', 'Please contact support.')}</p>
              </div>
            ) : (
              (productGroups as PortalProductGroup[]).map(group => {
                const isExpanded = expandedGroups.has(group.key);
                const groupContentId = `order-group-content-${group.key}`;

                return (
                  <div key={group.key} className="bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-sm">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={groupContentId}
                      onClick={() => toggleGroup(group.key)}
                      className="w-full bg-slate-50/80 px-5 py-4 border-b border-slate-100 font-extrabold text-slate-800 tracking-tight flex items-center gap-2 text-left"
                    >
                      <ChevronRight className={`w-4 h-4 text-primary transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      <ShoppingCart className="w-4 h-4 text-primary" />
                      {t(group.nameDe, group.nameEn)}
                    </button>
                    {isExpanded && (
                      <div id={groupContentId} className="divide-y divide-slate-100">
                        {(group.products ?? []).map(product => {
                          const qty = selection[product.id] ?? 0;
                          return (
                            <div key={product.id} className={`p-4 flex items-center justify-between transition-colors ${qty > 0 ? 'bg-primary/5' : ''}`}>
                              <div className="flex-1 pr-4">
                                <h4 className={`font-bold leading-tight ${qty > 0 ? 'text-primary' : 'text-slate-900'}`}>
                                  {t(product.nameDe, product.nameEn)}
                                </h4>
                                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mt-1">{product.sku}</p>
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                {qty === 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => setQty(product.id, 1, 0)}
                                    aria-label={t(`${product.nameDe} hinzufügen`, `Add ${product.nameEn}`)}
                                    className="w-11 h-11 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold hover:bg-slate-200 active:scale-95 transition-all"
                                  >
                                    <Plus className="w-5 h-5" />
                                  </button>
                                ) : (
                                  <div className="flex items-center bg-white border border-slate-200 rounded-full shadow-sm p-1">
                                    <button
                                      type="button"
                                      onClick={() => setQty(product.id, -1, qty)}
                                      aria-label={t(`${product.nameDe} entfernen`, `Remove ${product.nameEn}`)}
                                      className="w-11 h-11 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100 active:bg-slate-200"
                                    >
                                      <Minus className="w-4 h-4" />
                                    </button>
                                    <span className="w-8 text-center font-extrabold text-slate-900">{qty}</span>
                                    <button
                                      type="button"
                                      onClick={() => setQty(product.id, 1, qty)}
                                      aria-label={t(`${product.nameDe} hinzufügen`, `Add ${product.nameEn}`)}
                                      className="w-11 h-11 rounded-full flex items-center justify-center text-primary hover:bg-primary/10 active:bg-primary/20"
                                    >
                                      <Plus className="w-4 h-4" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Contact Form */}
        <div className="bg-white border border-slate-100 rounded-3xl p-5 shadow-sm space-y-4">
          <h3 className="font-extrabold text-slate-900">{t('Details', 'Details')}</h3>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 ml-1">{t('Ansprechpartner', 'Contact Name')}</label>
            <Input
              value={contactName}
              onChange={e => { setContactName(e.target.value); setDetailsConfirmed(false); }}
              className="h-12 rounded-2xl bg-slate-50 border-transparent focus-visible:bg-white focus-visible:border-primary font-medium"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 ml-1">{t('E-Mail', 'Email')}</label>
            <Input
              type="email"
              value={contactEmail}
              onChange={e => { setContactEmail(e.target.value); setDetailsConfirmed(false); }}
              className="h-12 rounded-2xl bg-slate-50 border-transparent focus-visible:bg-white focus-visible:border-primary font-medium"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 ml-1">{t('Telefon', 'Phone')}</label>
            <Input
              type="tel"
              value={contactPhone}
              onChange={e => { setContactPhone(e.target.value); setDetailsConfirmed(false); }}
              className="h-12 rounded-2xl bg-slate-50 border-transparent focus-visible:bg-white focus-visible:border-primary font-medium"
              required
            />
          </div>

          {mode === 'product' && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 ml-1">{t('Lieferadresse', 'Delivery Address')}</label>
              <Textarea
                value={deliveryAddress}
                onChange={e => { setDeliveryAddress(e.target.value); setDetailsConfirmed(false); }}
                className="min-h-[80px] rounded-2xl bg-slate-50 border-transparent focus-visible:bg-white focus-visible:border-primary font-medium resize-none"
                required
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 ml-1">{t('Anmerkungen', 'Notes')}</label>
            <Textarea
              value={notes}
              onChange={e => { setNotes(e.target.value); setDetailsConfirmed(false); }}
              className="min-h-[100px] rounded-2xl bg-slate-50 border-transparent focus-visible:bg-white focus-visible:border-primary font-medium resize-none"
            />
          </div>

          <div className="pt-2">
            <label className="flex items-start gap-3 p-3 rounded-2xl border border-slate-100 bg-slate-50/50 active:bg-slate-50 transition-colors">
              <input
                type="checkbox"
                checked={privacyConsent}
                onChange={e => setPrivacyConsent(e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-slate-300 text-primary focus:ring-primary"
              />
              <span className="text-xs font-medium text-slate-600 leading-snug">
                {t('Ich stimme der Datenverarbeitung gemäß Datenschutzerklärung zu.', 'I agree to the data processing policy.')} *
              </span>
            </label>
          </div>

          <div>
            <label className="flex items-start gap-3 p-3 rounded-2xl border border-primary/20 bg-primary/5 active:bg-primary/10 transition-colors">
              <input
                type="checkbox"
                checked={detailsConfirmed}
                onChange={e => setDetailsConfirmed(e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-slate-300 text-primary focus:ring-primary"
              />
              <span className="text-xs font-semibold text-slate-700 leading-snug">
                {t(
                  'Ich habe alle Angaben geprüft und bestätige, dass die Kontaktdaten, Lieferadresse und Bestellpositionen vollständig und korrekt sind.',
                  'I have reviewed all fields and confirm that the contact details, delivery address, and order items are complete and correct.',
                )} *
              </span>
            </label>
          </div>
        </div>

        <Button
          type="submit"
          className="w-full h-14 rounded-2xl text-base font-bold shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
          disabled={orderMutation.isPending || !canSubmit}
        >
          {orderMutation.isPending ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              {mode === 'product' ? t('Bestellen', 'Submit Order') : t('Anfragen', 'Submit Request')}
              <ChevronRight className="w-5 h-5" />
            </>
          )}
        </Button>
      </form>
    </Layout>
  );
}
