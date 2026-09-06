import { useState, useEffect, useRef, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSearch } from 'wouter';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  useSubmitOrder, useRegisterCustomer,
  OrderInputCustomerType, OrderInputInstrument,
  CustomerRegistrationInputInstrument,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useHumanCheck, HumanCheckWidget } from '@/components/HumanCheck';
import { GraduationCap, Megaphone, Plus, X, Info } from 'lucide-react';
import { CountrySelect } from '@/components/CountrySelect';

// ── Public product catalogue ───────────────────────────────────────────────────
interface PublicProduct { id: number; nameEn: string; nameDe: string; sku: string }
/** Products keyed by group key — group keys are dynamic (admin-managed). */
type PublicProductGroups = Record<string, PublicProduct[]>;
/** Admin-managed group metadata (ordered, non-service groups only). */
interface PublicGroup { id: number; key: string; nameEn: string; nameDe: string; sortOrder: number }

const FALLBACK_SPIRECUT = ['CTS', 'TF', 'Sono-Pack'];
const FALLBACK_MINISTEM = ['MiniStem System', 'Setup Accessory Kit', 'BioSpin Max Centrifuge', 'IncuShaker', 'Counter Balance', 'SVF Accessories'];
/** Used when the groups API is unreachable — mirrors the seeded defaults. */
const FALLBACK_GROUPS: PublicGroup[] = [
  { id: -1, key: 'spirecut', nameEn: 'Spirecut®', nameDe: 'Spirecut®', sortOrder: 1 },
  { id: -2, key: 'ministem', nameEn: 'MiniStem®', nameDe: 'MiniStem®', sortOrder: 2 },
  { id: -3, key: 'cellenis', nameEn: 'Cellenis®', nameDe: 'Cellenis®', sortOrder: 3 },
];

function usePublicProducts() {
  const [groups, setGroups] = useState<PublicProductGroups | null>(null);
  useEffect(() => {
    fetch('/api/products-public')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setGroups(data); })
      .catch(() => {});
  }, []);
  return groups;
}

function usePublicGroups(): PublicGroup[] {
  const [groups, setGroups] = useState<PublicGroup[]>(FALLBACK_GROUPS);
  useEffect(() => {
    fetch('/api/product-groups-public')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (Array.isArray(data) && data.length > 0) setGroups(data); })
      .catch(() => {});
  }, []);
  return groups;
}

function publicGroupLabel(groups: PublicGroup[], key: string, t: (de: string, en: string) => string): string {
  const g = groups.find(x => x.key === key);
  if (g) return t(g.nameDe, g.nameEn);
  const legacy = CATEGORY_LABELS[key];
  return legacy ? t(legacy.de, legacy.en) : key;
}

// ── DoctorCombobox ─────────────────────────────────────────────────────────────
// Searchable dropdown that falls back to free-text when the doctor is not listed.
// Works with plain HTML + React state; no Radix dependency needed on the public form.
function DoctorCombobox({
  value,
  onChange,
  doctors,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  doctors: {
    id: number;
    name: string;
    institutionName?: string | null;
  }[];
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? doctors.filter(d =>
        `${d.name} ${d.institutionName ?? ''}`.toLowerCase().includes(query.toLowerCase())
      )
    : doctors;

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        // If there's a free-text query but no selection, keep it as the value
        if (query && !value) onChange(query);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [query, value, onChange]);

  const displayValue = value || query;

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={disabled ? value : displayValue}
        disabled={disabled}
        placeholder={placeholder}
        onChange={e => {
          if (disabled) return;
          const v = e.target.value;
          setQuery(v);
          if (!v) onChange('');
          setOpen(true);
        }}
        onFocus={() => { if (!disabled) setOpen(true); }}
        className={disabled ? 'bg-muted text-muted-foreground cursor-not-allowed' : ''}
        autoComplete="off"
      />
      {open && !disabled && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-input rounded-md shadow-lg max-h-56 overflow-y-auto">
          {filtered.map(d => (
            <button
              key={d.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted/70 focus:bg-muted/70 focus:outline-none border-b border-input/40 last:border-0"
              onMouseDown={e => {
                e.preventDefault();
                onChange(d.name);
                setQuery('');
                setOpen(false);
              }}
            >
              <span className="block">{d.name}</span>
              {d.institutionName?.trim() && (
                <span className="block text-xs text-muted-foreground mt-0.5">
                  {d.institutionName}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────
type LineItemCategory = string;
type LineItem = { category: LineItemCategory; product: string; qty: number };

type ServiceType = 'post_training_support' | 'practice_marketing_support';

type OrderMode = 'product' | 'service';

function queryToMode(search: string): { mode: OrderMode; service: ServiceType | null } {
  const params = new URLSearchParams(search);
  const s = params.get('service');
  if (s === 'support') return { mode: 'service', service: 'post_training_support' };
  if (s === 'marketing') return { mode: 'service', service: 'practice_marketing_support' };
  return { mode: 'product', service: null };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, { de: string; en: string }> = {
  spirecut: { de: 'Spirecut®',  en: 'Spirecut®'    },
  ministem: { de: 'MiniStem®',  en: 'MiniStem®'    },
  cellenis: { de: 'Cellenis®',  en: 'Cellenis®'    },
  other:    { de: 'Zubehör',    en: 'Accessories'  }, // legacy key on old orders
};

/** Serialize line items for the email body (language-aware) */
function serializeLineItems(items: LineItem[], t: (de: string, en: string) => string, groups: PublicGroup[]): string {
  return items
    .filter(i => i.product.trim())
    .map(i => `${publicGroupLabel(groups, i.category, t)}: ${i.product} × ${i.qty}`)
    .join('\n');
}

/** Pick the primary instrument enum value from line items for the API */
function deriveInstrument(items: LineItem[]): 'spirecut' | 'ministem' {
  for (const i of items) {
    if (i.category === 'spirecut') return 'spirecut';
  }
  for (const i of items) {
    if (i.category === 'ministem') return 'ministem';
  }
  return 'spirecut'; // fallback for "other"-only orders
}

// ── ProductLineItemsEditor ─────────────────────────────────────────────────────
// Each row has its own category selector. Changing category only resets that row's
// product field (not other rows). Groups without listed products show a free-text input.

interface LineItemsEditorProps {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  publicProducts: PublicProductGroups | null;
  publicGroups: PublicGroup[];
  filterTraining?: boolean;
  t: (de: string, en: string) => string;
}

function getProductOptions(
  category: LineItemCategory,
  publicProducts: PublicProductGroups | null,
  filterTraining: boolean,
  t: (de: string, en: string) => string,
): { value: string; label: string }[] {
  const group = publicProducts?.[category];
  const fallback = category === 'ministem' ? FALLBACK_MINISTEM : category === 'spirecut' ? FALLBACK_SPIRECUT : [];
  const items = group && group.length > 0
    ? group.map(p => ({ value: p.nameEn, label: t(p.nameDe, p.nameEn) }))
    : fallback.map(name => ({ value: name, label: name }));
  return filterTraining
    ? items.filter(i => !i.value.toLowerCase().includes('training') && !i.label.toLowerCase().includes('training'))
    : items;
}

function ProductLineItemsEditor({ items, onChange, publicProducts, publicGroups, filterTraining = false, t }: LineItemsEditorProps) {
  const add = () => onChange([...items, { category: 'spirecut', product: '', qty: 1 }]);

  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  const updateCategory = (i: number, category: LineItemCategory) =>
    onChange(items.map((item, idx) => idx === i ? { ...item, category, product: '' } : item));

  const updateProduct = (i: number, product: string) =>
    onChange(items.map((item, idx) => idx === i ? { ...item, product } : item));

  const updateQty = (i: number, qty: number) =>
    onChange(items.map((item, idx) => idx === i ? { ...item, qty } : item));

  const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const options = getProductOptions(item.category, publicProducts, filterTraining, t);
        return (
          <div key={i} className="flex flex-wrap gap-2 items-center">
            {/* Category */}
            <select
              value={item.category}
              onChange={e => updateCategory(i, e.target.value as LineItemCategory)}
              className={`${selectCls} w-36 shrink-0`}
            >
              {publicGroups.map(g => (
                <option key={g.key} value={g.key}>{t(g.nameDe, g.nameEn)}</option>
              ))}
              {!publicGroups.some(g => g.key === item.category) && (
                <option value={item.category}>{publicGroupLabel(publicGroups, item.category, t)}</option>
              )}
            </select>

            {/* Product — dropdown, or free-text when the group has no listed products */}
            {options.length === 0 ? (
              <input
                type="text"
                value={item.product}
                onChange={e => updateProduct(i, e.target.value)}
                placeholder={t('Produktname eingeben…', 'Enter product name…')}
                className={`${selectCls} flex-1 min-w-0`}
              />
            ) : (
              <select
                value={item.product}
                onChange={e => updateProduct(i, e.target.value)}
                className={`${selectCls} flex-1 min-w-0`}
              >
                <option value="">{t('— Produkt wählen —', '— Select product —')}</option>
                {options.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            )}

            {/* Qty */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-muted-foreground">{t('Menge', 'Qty')}</span>
              <input
                type="number"
                min={1}
                value={item.qty}
                onChange={e => updateQty(i, Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="h-10 w-20 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>

            {/* Remove */}
            {items.length > 1 && (
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove"
                className="h-10 w-10 shrink-0 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-sm text-primary hover:underline mt-1"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('Weiteres Produkt hinzufügen', 'Add another product')}
      </button>
    </div>
  );
}

// ── Service Banner ─────────────────────────────────────────────────────────────
function ServiceBanner({ service, t }: { service: ServiceType; t: (de: string, en: string) => string }) {
  if (service === 'post_training_support') {
    return (
      <div className="flex items-start gap-4 p-5 rounded-xl bg-primary/5 border border-primary/15">
        <GraduationCap className="w-8 h-8 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-sm text-primary mb-0.5">
            {t('Post-Training Support & Begleitung', 'Post-Training Support and Guidance')}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t(
              'Kontinuierliche Unterstützung des medizinischen Fachpersonals für die sichere Integration neuer Medizintechnologien.',
              'Continuous support for medical staff to ensure the safe and efficient integration of new medical technologies into daily clinical routine.'
            )}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-4 p-5 rounded-xl bg-blue-50 border border-blue-100">
      <Megaphone className="w-8 h-8 text-primary shrink-0 mt-0.5" />
      <div>
        <p className="font-semibold text-sm text-primary mb-0.5">
          {t('Praxis-Marketing Support', 'Practice Marketing Support')}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t(
            'Individuelle Werbematerialien wie personalisierte Flyer mit Praxislogo für Ihre Patientenkommunikation.',
            'Customized promotional materials such as personalized flyers with practice logos to help you market new treatments.'
          )}
        </p>
      </div>
    </div>
  );
}

function ElectronicInvoiceNotice({ t }: { t: (de: string, en: string) => string }) {
  return (
    <aside className="mb-8 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">
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

// ── Page shell ─────────────────────────────────────────────────────────────────
export default function Order() {
  const { t } = useLanguage();
  const search = useSearch();
  const [isExistingCustomer, setIsExistingCustomer] = useState(true);
  const { mode: preMode, service: preService } = queryToMode(search);

  return (
    <div className="py-20 bg-muted/10 min-h-screen">
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-4xl font-bold mb-4">
          {preMode === 'service' ? t('Serviceanfrage', 'Service Request') : t('Bestellung', 'Order')}
        </h1>
        <p className="text-muted-foreground mb-12">
          {preMode === 'service'
            ? t('Füllen Sie das Formular aus, wir melden uns bei Ihnen.', 'Fill in the form and we will get back to you.')
            : t('Bestellen Sie unsere Instrumente für Ihre Praxis oder Klinik.', 'Order our instruments for your practice or clinic.')}
        </p>

        <div className="flex gap-4 mb-8">
          <Button variant={isExistingCustomer ? 'default' : 'outline'} onClick={() => setIsExistingCustomer(true)} className="flex-1">
            {t('Bestehender Kunde', 'Existing Customer')}
          </Button>
          <Button variant={!isExistingCustomer ? 'default' : 'outline'} onClick={() => setIsExistingCustomer(false)} className="flex-1">
            {t('Neuer Kunde', 'New Customer')}
          </Button>
        </div>

        <div className="bg-white p-8 rounded-2xl border shadow-sm">
          <ElectronicInvoiceNotice t={t} />
          {isExistingCustomer
            ? <ExistingCustomerForm key={search} initialMode={preMode} initialService={preService} />
            : <NewCustomerForm key={search} initialMode={preMode} initialService={preService} />}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXISTING CUSTOMER FORM
// ═══════════════════════════════════════════════════════════════════════════════

// Language-aware schema — rebuilt on language switch, used as zodResolver
const makeExistingSchema = (lang: string) => z.object({
  customerNr:          z.string().min(1,  lang === 'DE' ? 'Pflichtfeld'               : 'Required'),
  reorderCode:         z.string().min(1,  lang === 'DE' ? 'Pflichtfeld'               : 'Required'),
  contactName:         z.string().optional(),
  contactEmail:        z.string().email(  lang === 'DE' ? 'Ungültige E-Mail-Adresse'  : 'Invalid email'),
  contactPhone:        z.string().optional(),
  treatingDoctorName:  z.string().optional().or(z.literal('')),
  deliveryAddress:     z.string().optional(),
  street:              z.string().optional(),
  houseNumber:         z.string().optional(),
  notes:               z.string().optional(),
  privacyConsent:      z.boolean().refine(v => v === true, lang === 'DE' ? 'Pflichtfeld' : 'Required'),
});
type ExistingFormData = z.infer<ReturnType<typeof makeExistingSchema>>;

function ExistingCustomerForm({
  initialMode,
  initialService,
}: {
  initialMode: OrderMode;
  initialService: ServiceType | null;
}) {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const captcha = useHumanCheck();
  const publicProducts = usePublicProducts();
  const publicGroups = usePublicGroups();

  const [orderMode, setOrderMode] = useState<OrderMode>(initialMode);
  const [serviceType, setServiceType] = useState<ServiceType>(initialService ?? 'post_training_support');
  const [lineItems, setLineItems] = useState<LineItem[]>([{ category: 'spirecut', product: '', qty: 1 }]);
  const [certifiedDoctors, setCertifiedDoctors] = useState<{ id: number; name: string }[]>([]);

  const validationSchema = useMemo(() => makeExistingSchema(language), [language]);
  const form = useForm<ExistingFormData>({
    resolver: zodResolver(validationSchema),
    defaultValues: { privacyConsent: false },
  });

  // Fetch all certified doctors for the "ordering for" combobox
  useEffect(() => {
    fetch('/api/certified-doctors')
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setCertifiedDoctors(data); })
      .catch(() => {});
  }, []);

  const submitOrder = useSubmitOrder({
    mutation: {
      onSuccess: () => {
        toast({
          title: t('Erfolgreich', 'Success'),
          description: orderMode === 'service'
            ? t('Anfrage gesendet. Wir melden uns bald!', 'Request sent. We will get back to you soon!')
            : t(
                'Bestellung erhalten. Bitte bestätigen Sie die Bestellung über den Link in Ihrer E-Mail.',
                'Order received. Please confirm your order using the link in your email.'
              ),
        });
        form.reset({ privacyConsent: false });
        setLineItems([{ category: 'spirecut', product: '', qty: 1 }]);
        captcha.reset();
      },
      onError: (err: unknown) => {
        const msg = String((err as { data?: { error?: string } })?.data?.error ?? '');
        const isCodeError = msg === 'CUSTOMER_CODE_INVALID' || msg === 'CUSTOMER_CODE_REQUIRED';
        const isBlocked = msg === 'TOO_MANY_ATTEMPTS';
        toast({
          variant: 'destructive',
          title: t('Fehler', 'Error'),
          description: isBlocked
            ? t(
                'Zu viele Fehlversuche. Aus Sicherheitsgründen sind Sie für die nächsten 24 Stunden gesperrt. Bitte versuchen Sie es später erneut oder kontaktieren Sie die iROC GmbH über die Kontakt-E-Mail auf der Website.',
                'Too many failed attempts. For security reasons you are blocked for the next 24 hours. Please try again later or contact iROC GmbH via the contact email on the website.'
              )
            : isCodeError
            ? t(
                'Kundennummer oder Bestellcode ungültig. Bitte prüfen Sie Ihre Angaben (siehe letzte Rechnung).',
                'Customer number or reorder code invalid. Please check your details (see your last invoice).'
              )
            : t('Fehler beim Senden.', 'Failed to send.'),
        });
      },
    },
  });

  const onSubmit = (data: ExistingFormData) => {
    if (!captcha.verified) return;

    const instrument: OrderInputInstrument = orderMode === 'service'
      ? serviceType as OrderInputInstrument
      : deriveInstrument(lineItems) as OrderInputInstrument;

    const products = orderMode === 'product' ? (serializeLineItems(lineItems, t, publicGroups) || null) : null;

    // Merge the ordering-doctor into notes so the admin sees it on the order
    const { treatingDoctorName, ...restData } = data;
    const noteParts = [
      restData.notes,
      treatingDoctorName ? `${t('Bestellender/Behandelnder Arzt', 'Ordering / Treating Doctor')}: ${treatingDoctorName}` : '',
    ].filter(Boolean).join('\n\n');

    submitOrder.mutate({
      data: {
        ...restData,
        notes: noteParts || undefined,
        companyName: '', // derived server-side from the identified customer
        customerType: OrderInputCustomerType.existing,
        instrument,
        products,
        quantity: null,
      },
    });
  };

  const modeBtnCls = (active: boolean) =>
    `flex-1 py-2 px-4 rounded-md text-sm font-medium border transition-colors ${
      active
        ? 'bg-primary text-primary-foreground border-primary'
        : 'bg-background text-foreground border-input hover:bg-muted'
    }`;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 animate-in fade-in zoom-in duration-300">

      {/* Identification via customer number + reorder code */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          {t(
            'Identifizieren Sie sich mit Ihrer Kundennummer und Ihrem persönlichen Bestellcode. Beides finden Sie auf Ihrer letzten Rechnung.',
            'Identify yourself with your customer number and your personal reorder code. You can find both on your last invoice.'
          )}
        </p>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('Kundennummer', 'Customer Number')} *</label>
            <Input {...form.register('customerNr')} placeholder="2026-0001" />
            {form.formState.errors.customerNr && <p className="text-xs text-destructive">{form.formState.errors.customerNr.message}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('Bestellcode', 'Reorder Code')} *</label>
            <Input {...form.register('reorderCode')} placeholder="ABCD2345" className="uppercase" maxLength={8} />
            {form.formState.errors.reorderCode && <p className="text-xs text-destructive">{form.formState.errors.reorderCode.message}</p>}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Kontaktperson', 'Contact Name')}</label>
          <Input {...form.register('contactName')} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('E-Mail', 'Email')} *</label>
          <Input {...form.register('contactEmail')} type="email" />
          {form.formState.errors.contactEmail && <p className="text-xs text-destructive">{form.formState.errors.contactEmail.message}</p>}
          <p className="text-xs text-muted-foreground">
            {t('An diese Adresse senden wir den Bestätigungslink.', 'We will send the confirmation link to this address.')}
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Telefon', 'Phone')}</label>
          <Input {...form.register('contactPhone')} />
        </div>
      </div>

      {/* Order type toggle */}
      <div className="space-y-3 border-t pt-5">
        <label className="text-sm font-medium">{t('Auftragsart', 'Order Type')} *</label>
        <div className="flex gap-2">
          <button type="button" className={modeBtnCls(orderMode === 'product')} onClick={() => setOrderMode('product')}>
            {t('Produktbestellung', 'Product Order')}
          </button>
          <button type="button" className={modeBtnCls(orderMode === 'service')} onClick={() => setOrderMode('service')}>
            {t('Serviceanfrage', 'Service Request')}
          </button>
        </div>
      </div>

      {/* Service type + banner */}
      {orderMode === 'service' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('Service', 'Service')} *</label>
            <select
              value={serviceType}
              onChange={e => setServiceType(e.target.value as ServiceType)}
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="post_training_support">{t('Post-Training Support & Begleitung', 'Post-Training Support and Guidance')}</option>
              <option value="practice_marketing_support">{t('Praxis-Marketing Support', 'Practice Marketing Support')}</option>
            </select>
          </div>
          <ServiceBanner service={serviceType} t={t} />
        </div>
      )}

      {/* Product line items */}
      {orderMode === 'product' && (
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Bestellte Produkte', 'Ordered Products')}</label>
          <p className="text-xs text-muted-foreground">
            {t('Sie können mehrere Kategorien und Produkte in einer Bestellung kombinieren.', 'You can combine multiple categories and products in one order.')}
          </p>
          <ProductLineItemsEditor
            publicGroups={publicGroups}
            items={lineItems}
            onChange={setLineItems}
            publicProducts={publicProducts}
            filterTraining={true}
            t={t}
          />
        </div>
      )}

      {/* Ordering / treating doctor */}
      <div className="space-y-2 border-t pt-5">
        <label className="text-sm font-medium">{t('Bestellender / Behandelnder Arzt', 'Ordering / Treating Doctor')}</label>
        <p className="text-xs text-muted-foreground">
          {t(
            'Für welchen zertifizierten Arzt wird bestellt? Wählen Sie aus der Liste oder geben Sie den Namen manuell ein.',
            'For which certified doctor is this ordered? Select from the list or type a name manually.'
          )}
        </p>
        <DoctorCombobox
          value={(form.watch('treatingDoctorName') as string) ?? ''}
          onChange={v => form.setValue('treatingDoctorName', v, { shouldValidate: true })}
          doctors={certifiedDoctors}
          placeholder={t('Name suchen oder eingeben …', 'Search or enter name …')}
        />
      </div>

      {/* Delivery address (product only) */}
      {orderMode === 'product' && (
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Abweichende Lieferadresse', 'Different Delivery Address')}</label>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground">{t('Straße', 'Street')}</label>
              <Input {...form.register('street')} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('Hausnr.', 'No.')}</label>
              <Input {...form.register('houseNumber')} />
            </div>
          </div>
          <Textarea {...form.register('deliveryAddress')} placeholder={t('Adresszusatz (optional)', 'Address addition (optional)')} />
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">{t('Anmerkungen', 'Notes')}</label>
        <Textarea {...form.register('notes')} />
      </div>

      <div className="flex items-start gap-2 pt-4 border-t">
        <input type="checkbox" id="privacy-ext" {...form.register('privacyConsent')} className="mt-1" />
        <label htmlFor="privacy-ext" className="text-sm text-muted-foreground">
          {t('Ich stimme der Verarbeitung meiner Daten gemäß der Datenschutzerklärung zu.', 'I agree to the privacy policy.')} *
        </label>
      </div>

      <HumanCheckWidget {...captcha} />

      <Button type="submit" size="lg" className="w-full" disabled={submitOrder.isPending || !captcha.verified}>
        {submitOrder.isPending
          ? t('Sende...', 'Sending...')
          : orderMode === 'service' ? t('Anfrage senden', 'Submit Request') : t('Bestellung senden', 'Submit Order')}
      </Button>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW CUSTOMER FORM
// ═══════════════════════════════════════════════════════════════════════════════

// Module-level: shape for TypeScript inference only
// Language-aware validation schema factory
const makeNewSchema = (lang: string) => z.object({
  salutation:         z.string().optional().or(z.literal('')),
  title:              z.string().optional(),
  // Either firstName+lastName OR institutionName is required (validated in onSubmit)
  firstName:          z.string().optional().or(z.literal('')),
  lastName:           z.string().optional().or(z.literal('')),
  specialty:          z.string().optional().or(z.literal('')),
  institutionName:    z.string().optional().or(z.literal('')),
  institutionType:    z.string().optional().or(z.literal('')),
  treatingDoctorName: z.string().optional().or(z.literal('')),
  address:            z.string().min(1, lang === 'DE' ? 'Pflichtfeld'              : 'Required'),
  postalCode:         z.string().min(1, lang === 'DE' ? 'Pflichtfeld'              : 'Required'),
  city:               z.string().min(1, lang === 'DE' ? 'Pflichtfeld'              : 'Required'),
  country:            z.string().min(1, lang === 'DE' ? 'Pflichtfeld'              : 'Required'),
  phone:              z.string().min(1, lang === 'DE' ? 'Pflichtfeld'              : 'Required'),
  fax:                z.string().optional(),
  email:              z.string().email(lang === 'DE'  ? 'Ungültige E-Mail-Adresse' : 'Invalid email'),
  website:            z.string().optional(),
  referenceNumber:    z.string().optional(),
  ustIdNr:            z.string().optional(),
  notes:              z.string().optional(),
  privacyConsent:     z.boolean().refine(v => v === true, lang === 'DE' ? 'Pflichtfeld' : 'Required'),
  shippingFirstName:       z.string().optional(),
  shippingLastName:        z.string().optional(),
  shippingInstitutionName: z.string().optional(),
  shippingAddress:         z.string().optional(),
  shippingPostalCode:      z.string().optional(),
  shippingCity:            z.string().optional(),
  shippingCountry:         z.string().optional(),
  shippingPhone:           z.string().optional(),
  shippingEmail:           z.string().email(lang === 'DE' ? 'Ungültige E-Mail-Adresse' : 'Invalid email').optional().or(z.literal('')),
});
type NewFormData = z.infer<ReturnType<typeof makeNewSchema>>;

function NewCustomerForm({
  initialMode = 'product',
  initialService = null,
}: {
  initialMode?: OrderMode;
  initialService?: ServiceType | null;
}) {
  const { t, language } = useLanguage();
  const lang = t('de', 'en');
  const { toast } = useToast();
  const captcha = useHumanCheck();
  const publicProducts = usePublicProducts();
  const publicGroups = usePublicGroups();

  const [orderMode, setOrderMode] = useState<OrderMode>(initialMode);
  const [serviceType, setServiceType] = useState<ServiceType>(initialService ?? 'post_training_support');

  const [lineItems, setLineItems] = useState<LineItem[]>([{ category: 'spirecut', product: '', qty: 1 }]);
  const [lineItemsError, setLineItemsError] = useState<string | null>(null);
  const [diffShipping, setDiffShipping] = useState(false);
  const [shippingErrors, setShippingErrors] = useState<Record<string, string>>({});

  const newValidationSchema = useMemo(() => makeNewSchema(language), [language]);
  const form = useForm<NewFormData>({
    resolver: zodResolver(newValidationSchema),
    defaultValues: { privacyConsent: false },
  });

  // ── Institution name → address suggestion (debounced 800 ms) ────────────────
  const institutionNameVal = form.watch('institutionName') as string ?? '';
  type InstResult = { address: string; postalCode: string; city: string; countryCode: string; displayName: string };
  const [instSuggestions, setInstSuggestions] = useState<InstResult[]>([]);
  const [vatLookupBusy, setVatLookupBusy]     = useState(false);
  // Generation counter: only the latest VAT lookup may write the field, and a
  // manual edit invalidates any in-flight lookup.
  const vatGenRef = useRef(0);
  useEffect(() => {
    setInstSuggestions([]);
    if (!institutionNameVal || institutionNameVal.length < 3) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/lookup-institution?name=${encodeURIComponent(institutionNameVal)}`
        );
        if (res.ok) {
          const d = await res.json();
          if (Array.isArray(d)) setInstSuggestions(d.filter((r: InstResult) => r.city || r.postalCode));
        }
      } catch { /* Institution lookup is optional. */ }
    }, 800);
    return () => clearTimeout(timer);
  }, [institutionNameVal]);

  // ── Postal-code → city/country suggestion (billing) ──────────────────────────
  const billingPostal   = form.watch('postalCode') as string ?? '';
  const billingCountry  = form.watch('country')    as string ?? '';
  const [billingSugg, setBillingSugg]           = useState<{ city: string; countryCode: string; postcode: string } | null>(null);
  const [billingSuggDismissed, setBillingSuggDismissed] = useState(false);
  useEffect(() => {
    setBillingSugg(null); setBillingSuggDismissed(false);
    if (!billingPostal || billingPostal.length < 4) return;
    const cc = billingCountry.length === 2 ? billingCountry : 'DE';
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/lookup-postal?postalCode=${encodeURIComponent(billingPostal)}&countryCode=${encodeURIComponent(cc)}`);
        if (res.ok) { const d = await res.json(); if (d.city) setBillingSugg(d); }
      } catch { /* Postal lookup is optional. */ }
    }, 700);
    return () => clearTimeout(timer);
  }, [billingPostal, billingCountry]);

  // ── Postal-code → city/country suggestion (shipping) ─────────────────────────
  const shippingPostal  = form.watch('shippingPostalCode') as string ?? '';
  const shippingWatchCountry = form.watch('shippingCountry') as string ?? '';
  const [shippingSugg, setShippingSugg]           = useState<{ city: string; countryCode: string; postcode: string } | null>(null);
  const [shippingSuggDismissed, setShippingSuggDismissed] = useState(false);
  useEffect(() => {
    setShippingSugg(null); setShippingSuggDismissed(false);
    if (!diffShipping || !shippingPostal || shippingPostal.length < 4) return;
    const cc = shippingWatchCountry.length === 2 ? shippingWatchCountry : 'DE';
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/lookup-postal?postalCode=${encodeURIComponent(shippingPostal)}&countryCode=${encodeURIComponent(cc)}`);
        if (res.ok) { const d = await res.json(); if (d.city) setShippingSugg(d); }
      } catch { /* Postal lookup is optional. */ }
    }, 700);
    return () => clearTimeout(timer);
  }, [shippingPostal, shippingWatchCountry, diffShipping]);

  // Certified doctors — re-fetched whenever the selected product categories change
  const [certifiedDoctors, setCertifiedDoctors] = useState<{ id: number; name: string }[]>([]);
  const selectedInstrumentKey = [...new Set(lineItems.map(i => i.category))].sort().join(',');
  useEffect(() => {
    const instruments = [...new Set(lineItems.map(i => i.category).filter(Boolean))];
    const qs = instruments.length > 0
      ? '?' + instruments.map(i => `instrument=${encodeURIComponent(i)}`).join('&')
      : '';
    fetch(`/api/certified-doctors${qs}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setCertifiedDoctors(data); })
      .catch(() => {});
  }, [selectedInstrumentKey]);

  const registerCustomer = useRegisterCustomer({
    mutation: {
      onSuccess: () => {
        toast({
          title: t('Registriert', 'Registered'),
          description: t(
            'Registrierung erhalten. Wir werden uns in Kürze bei Ihnen melden.',
            'Registration received. We will be in touch with you shortly.'
          ),
        });
        form.reset({ privacyConsent: false });
        setLineItems([{ category: 'spirecut', product: '', qty: 1 }]);
        setLineItemsError(null);
        captcha.reset();
      },
      onError: () => {
        toast({
          variant: 'destructive',
          title: t('Fehler', 'Error'),
          description: t('Fehler beim Senden. Bitte versuchen Sie es erneut.', 'Failed to send. Please try again.'),
        });
      },
    },
  });

  const onSubmit = (data: NewFormData) => {
    if (!captcha.verified) return;

    // Validate: first+last name OR institution name is required
    const hasPersonName = !!(data.firstName?.trim() && data.lastName?.trim());
    const hasInstitution = !!data.institutionName?.trim();
    if (!hasPersonName && !hasInstitution) {
      form.setError('institutionName', {
        message: t(
          'Bitte geben Sie Vor- und Nachname oder den Namen der Institution an.',
          'Please provide first and last name, or the institution name.'
        ),
      });
      return;
    }

    // Salutation is required only when a personal name is provided
    if (hasPersonName && !data.salutation?.trim()) {
      form.setError('salutation', {
        message: t('Bitte wählen Sie eine Anrede aus.', 'Please select a salutation.'),
      });
      return;
    }

    setLineItemsError(null);

    // Validate shipping fields when toggle is on
    if (diffShipping) {
      const required: Array<[keyof typeof data, string]> = [
        ['shippingFirstName',       t('Vorname', 'First Name')],
        ['shippingLastName',        t('Nachname', 'Last Name')],
        ['shippingInstitutionName', t('Name der Institution', 'Institution Name')],
        ['shippingAddress',         t('Straße und Hausnummer', 'Address')],
        ['shippingPostalCode',      'PLZ'],
        ['shippingCity',            t('Stadt', 'City')],
        ['shippingCountry',         t('Land', 'Country')],
        ['shippingPhone',           t('Telefon', 'Phone')],
        ['shippingEmail',           'E-Mail'],
      ];
      const errs: Record<string, string> = {};
      for (const [field, label] of required) {
        const v = data[field];
        if (typeof v !== 'string' || !v.trim()) errs[field] = `${label} ${t('ist erforderlich', 'is required')}`;
      }
      if (Object.keys(errs).length > 0) { setShippingErrors(errs); return; }
    }
    setShippingErrors({});

    const productStr = orderMode === 'product' ? serializeLineItems(lineItems, t, publicGroups) : '';
    const servicePart = orderMode === 'service'
      ? `${t('Serviceanfrage', 'Service Request')}: ${serviceType === 'post_training_support'
          ? t('Post-Training Support & Begleitung', 'Post-Training Support and Guidance')
          : t('Praxis-Marketing Support', 'Practice Marketing Support')}`
      : '';
    const noteParts = [
      data.notes,
      servicePart,
      productStr ? `${t('Produkte', 'Products')}:\n${productStr}` : '',
    ].filter(Boolean).join('\n\n');

    const instrument: CustomerRegistrationInputInstrument = orderMode === 'service'
      ? serviceType as CustomerRegistrationInputInstrument
      : deriveInstrument(lineItems) as CustomerRegistrationInputInstrument;

    registerCustomer.mutate({
      data: {
        ...data,
        firstName: data.firstName || undefined,
        lastName: data.lastName || undefined,
        institutionName: data.institutionName || undefined,
        specialty: data.specialty || undefined,
        institutionType: data.institutionType || undefined,
        treatingDoctorName: data.treatingDoctorName || null,
        instrument,
        notes: noteParts || undefined,
        // Only send shipping fields when the toggle is active
        shippingFirstName:       diffShipping ? (data.shippingFirstName ?? null) : null,
        shippingLastName:        diffShipping ? (data.shippingLastName ?? null) : null,
        shippingInstitutionName: diffShipping ? (data.shippingInstitutionName ?? null) : null,
        shippingAddress:         diffShipping ? (data.shippingAddress ?? null) : null,
        shippingPostalCode:      diffShipping ? (data.shippingPostalCode ?? null) : null,
        shippingCity:            diffShipping ? (data.shippingCity ?? null) : null,
        shippingCountry:         diffShipping ? (data.shippingCountry ?? null) : null,
        shippingPhone:           diffShipping ? (data.shippingPhone ?? null) : null,
        shippingEmail:           diffShipping ? (data.shippingEmail ?? null) : null,
      },
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 animate-in fade-in zoom-in duration-300">
      <div className="grid md:grid-cols-2 gap-6">

        {/* Personal info */}
        <div className="col-span-2">
          <p className="text-xs text-muted-foreground">
            {t(
              '* Pflichtfeld. Bitte füllen Sie entweder Vor- und Nachname ODER den Institutionsnamen aus.',
              '* Required. Please provide either first and last name OR institution name.'
            )}
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {t('Anrede', 'Salutation')}
            <span className="text-muted-foreground text-xs ml-1">({t('bei Personenname erforderlich', 'required with personal name')})</span>
          </label>
          <select {...form.register('salutation')} className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">{t('— bitte wählen —', '— please select —')}</option>
            <option value="Herr">{t('Herr', 'Mr.')}</option>
            <option value="Frau">{t('Frau', 'Mrs.')}</option>
            <option value="Divers">{t('Divers', 'Diverse')}</option>
            <option value="Andere">{t('Andere', 'Other')}</option>
          </select>
          {form.formState.errors.salutation && <p className="text-xs text-destructive">{form.formState.errors.salutation.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Titel', 'Title')}</label>
          <Input {...form.register('title')} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Vorname', 'First Name')}</label>
          <Input {...form.register('firstName')} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Nachname', 'Last Name')}</label>
          <Input {...form.register('lastName')} />
        </div>

        {/* Institution — with typeahead dropdown */}
        <div className="col-span-2 space-y-2">
          <label className="text-sm font-medium">{t('Name der Institution', 'Institution Name')}</label>
          <div className="relative">
            <Input
              {...form.register('institutionName')}
              onBlur={() => setTimeout(() => setInstSuggestions([]), 150)}
            />
            {instSuggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-y-auto">
                {instSuggestions.map((s, i) => (
                  <li key={i}
                    className="px-3 py-2.5 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950 border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const name = s.displayName.split(',')[0].trim();
                      if (name)          form.setValue('institutionName', name);
                      if (s.address)     form.setValue('address',         s.address);
                      if (s.postalCode)  form.setValue('postalCode',      s.postalCode);
                      if (s.city)        form.setValue('city',            s.city);
                      if (s.countryCode) form.setValue('country',         s.countryCode);
                      setInstSuggestions([]);
                      // Auto-fill the VAT ID for non-German institutions
                      if (s.countryCode && s.countryCode !== 'DE') {
                        const gen = ++vatGenRef.current;
                        form.setValue('ustIdNr', '');
                        setVatLookupBusy(true);
                        const params = new URLSearchParams({ institutionName: name, country: s.countryCode, city: s.city || '' });
                        fetch(`/api/lookup-vat?${params}`)
                          .then(r => r.ok ? r.json() : { vatId: null })
                          .then((d: { vatId: string | null }) => {
                            if (gen !== vatGenRef.current) return; // stale response — discard
                            if (d.vatId) form.setValue('ustIdNr', d.vatId);
                          })
                          .catch(() => {})
                          .finally(() => { if (gen === vatGenRef.current) setVatLookupBusy(false); });
                      }
                    }}>
                    <div className="text-sm font-medium">{s.displayName.split(',')[0].trim()}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {[s.address, s.postalCode, s.city, s.countryCode].filter(Boolean).join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {form.formState.errors.institutionName && <p className="text-xs text-destructive">{form.formState.errors.institutionName.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Art der Institution', 'Institution Type')}</label>
          <select {...form.register('institutionType')} className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">{t('— bitte wählen —', '— please select —')}</option>
            <option value="Krankenhaus">{t('Krankenhaus', 'Hospital')}</option>
            <option value="Klinik">{t('Klinik', 'Clinic')}</option>
            <option value="Praxis">{t('Praxis', 'Practice')}</option>
            <option value="Andere">{t('Andere', 'Other')}</option>
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Fachgebiet', 'Specialty')}</label>
          <Input {...form.register('specialty')} />
        </div>

        {/* Billing Address */}
        <div className="col-span-2 space-y-2 border-t pt-4">
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t('Rechnungsadresse', 'Billing Address')}</p>
          <label className="text-sm font-medium">{t('Straße und Hausnummer', 'Address')} *</label>
          <Input {...form.register('address')} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('PLZ', 'Postal Code')} *</label>
          <Input {...form.register('postalCode')} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Stadt', 'City')} *</label>
          <Input {...form.register('city')} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Land', 'Country')} *</label>
          <Controller
            name="country"
            control={form.control}
            render={({ field }) => (
              <CountrySelect value={field.value ?? ''} onChange={field.onChange} lang={lang} />
            )}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {t('USt-IdNr', 'VAT ID')} ({t('erforderlich für Nicht-DE', 'required for non-DE')})
            {vatLookupBusy && <span className="ml-2 text-xs text-blue-600 animate-pulse">{t('Suche…', 'Searching…')}</span>}
          </label>
          <Input {...form.register('ustIdNr', { onChange: () => { vatGenRef.current++; } })} />
        </div>

        {/* Postal suggestion banner (billing) */}
        {billingSugg && !billingSuggDismissed && (
          <div className="col-span-2 flex items-center gap-2 text-xs bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2">
            <span className="flex-1 text-blue-800 dark:text-blue-200">
              💡 {t('Vorschlag basierend auf PLZ', 'Suggestion based on postal code')}:{' '}
              <strong>{billingSugg.city}</strong>
              {billingSugg.countryCode && <>, <strong>{billingSugg.countryCode}</strong></>}
            </span>
            <button
              type="button"
              onClick={() => {
                if (billingSugg.city) form.setValue('city', billingSugg.city);
                if (billingSugg.countryCode) form.setValue('country', billingSugg.countryCode);
                if (billingSugg.postcode) form.setValue('postalCode', billingSugg.postcode);
                setBillingSugg(null);
              }}
              className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900 rounded text-blue-800 dark:text-blue-200 hover:bg-blue-200 font-medium whitespace-nowrap"
            >
              {t('Übernehmen', 'Apply')}
            </button>
            <button
              type="button"
              onClick={() => setBillingSuggDismissed(true)}
              className="px-1.5 py-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-500"
              aria-label="Dismiss"
            >✕</button>
          </div>
        )}

        {/* Contact */}
        <div className="col-span-2 space-y-2 border-t pt-4">
          <label className="text-sm font-medium">{t('E-Mail', 'Email')} *</label>
          <Input {...form.register('email')} type="email" />
          {form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Telefon', 'Phone')} *</label>
          <Input {...form.register('phone')} />
        </div>

        {/* Shipping address toggle */}
        <div className="col-span-2 flex items-center gap-3 pt-2">
          <input
            type="checkbox"
            id="diff-shipping"
            checked={diffShipping}
            onChange={e => { setDiffShipping(e.target.checked); setShippingErrors({}); }}
            className="h-4 w-4 rounded border border-input"
          />
          <label htmlFor="diff-shipping" className="text-sm font-medium cursor-pointer">
            {t('Lieferadresse weicht von Rechnungsadresse ab', 'Shipping address differs from billing address')}
          </label>
        </div>

        {/* Shipping address fields */}
        {diffShipping && (
          <>
            <div className="col-span-2 pt-1">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t('Lieferadresse', 'Shipping Address')}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Vorname', 'First Name')} *</label>
              <Input {...form.register('shippingFirstName')} />
              {shippingErrors.shippingFirstName && <p className="text-xs text-destructive">{shippingErrors.shippingFirstName}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Nachname', 'Last Name')} *</label>
              <Input {...form.register('shippingLastName')} />
              {shippingErrors.shippingLastName && <p className="text-xs text-destructive">{shippingErrors.shippingLastName}</p>}
            </div>
            <div className="col-span-2 space-y-2">
              <label className="text-sm font-medium">{t('Name der Institution', 'Institution Name')} *</label>
              <Input {...form.register('shippingInstitutionName')} />
              {shippingErrors.shippingInstitutionName && <p className="text-xs text-destructive">{shippingErrors.shippingInstitutionName}</p>}
            </div>
            <div className="col-span-2 space-y-2">
              <label className="text-sm font-medium">{t('Straße und Hausnummer', 'Address')} *</label>
              <Input {...form.register('shippingAddress')} />
              {shippingErrors.shippingAddress && <p className="text-xs text-destructive">{shippingErrors.shippingAddress}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">PLZ *</label>
              <Input {...form.register('shippingPostalCode')} />
              {shippingErrors.shippingPostalCode && <p className="text-xs text-destructive">{shippingErrors.shippingPostalCode}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Stadt', 'City')} *</label>
              <Input {...form.register('shippingCity')} />
              {shippingErrors.shippingCity && <p className="text-xs text-destructive">{shippingErrors.shippingCity}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Land', 'Country')} *</label>
              <Controller
                name="shippingCountry"
                control={form.control}
                render={({ field }) => (
                  <CountrySelect value={field.value ?? ''} onChange={field.onChange} lang={lang} />
                )}
              />
              {shippingErrors.shippingCountry && <p className="text-xs text-destructive">{shippingErrors.shippingCountry}</p>}
            </div>

            {/* Postal suggestion banner (shipping) */}
            {shippingSugg && !shippingSuggDismissed && (
              <div className="col-span-2 flex items-center gap-2 text-xs bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2">
                <span className="flex-1 text-blue-800 dark:text-blue-200">
                  💡 {t('Vorschlag basierend auf PLZ', 'Suggestion based on postal code')}:{' '}
                  <strong>{shippingSugg.city}</strong>
                  {shippingSugg.countryCode && <>, <strong>{shippingSugg.countryCode}</strong></>}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (shippingSugg.city) form.setValue('shippingCity', shippingSugg.city);
                    if (shippingSugg.countryCode) form.setValue('shippingCountry', shippingSugg.countryCode);
                    if (shippingSugg.postcode) form.setValue('shippingPostalCode', shippingSugg.postcode);
                    setShippingSugg(null);
                  }}
                  className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900 rounded text-blue-800 dark:text-blue-200 hover:bg-blue-200 font-medium whitespace-nowrap"
                >
                  {t('Übernehmen', 'Apply')}
                </button>
                <button
                  type="button"
                  onClick={() => setShippingSuggDismissed(true)}
                  className="px-1.5 py-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-500"
                  aria-label="Dismiss"
                >✕</button>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">E-Mail *</label>
              <Input {...form.register('shippingEmail')} type="email" />
              {shippingErrors.shippingEmail && <p className="text-xs text-destructive">{shippingErrors.shippingEmail}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Telefon', 'Phone')} *</label>
              <Input {...form.register('shippingPhone')} />
              {shippingErrors.shippingPhone && <p className="text-xs text-destructive">{shippingErrors.shippingPhone}</p>}
            </div>
          </>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Fax', 'Fax')}</label>
          <Input {...form.register('fax')} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Referenznummer', 'Reference Number')}</label>
          <Input {...form.register('referenceNumber')} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('Website', 'Website')}</label>
          <Input {...form.register('website')} />
        </div>

        {/* Order type toggle */}
        <div className="col-span-2 space-y-3 border-t pt-5">
          <label className="text-sm font-medium">{t('Auftragsart', 'Order Type')} *</label>
          <div className="flex gap-2">
            {(['product', 'service'] as OrderMode[]).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setOrderMode(mode)}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium border transition-colors ${
                  orderMode === mode
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground border-input hover:bg-muted'
                }`}
              >
                {mode === 'product' ? t('Produktbestellung', 'Product Order') : t('Serviceanfrage', 'Service Request')}
              </button>
            ))}
          </div>
        </div>

        {/* Service type + banner */}
        {orderMode === 'service' && (
          <div className="col-span-2 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Service', 'Service')} *</label>
              <select
                value={serviceType}
                onChange={e => setServiceType(e.target.value as ServiceType)}
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="post_training_support">{t('Post-Training Support & Begleitung', 'Post-Training Support and Guidance')}</option>
                <option value="practice_marketing_support">{t('Praxis-Marketing Support', 'Practice Marketing Support')}</option>
              </select>
            </div>
            <ServiceBanner service={serviceType} t={t} />
          </div>
        )}

        {/* Products — optional; Training items filtered out; hidden in service mode */}
        {orderMode === 'product' && (
        <div className="col-span-2 space-y-2 border-t pt-4">
          <label className="text-sm font-medium">{t('Produkte', 'Products')}</label>
          <p className="text-xs text-muted-foreground">
            {t('Sie können mehrere Kategorien und Produkte kombinieren.', 'You can combine multiple categories and products.')}
          </p>
          <ProductLineItemsEditor
            publicGroups={publicGroups}
            items={lineItems}
            onChange={items => { setLineItems(items); if (lineItemsError) setLineItemsError(null); }}
            publicProducts={publicProducts}
            filterTraining={true}
            t={t}
          />
          {lineItemsError && <p className="text-xs text-destructive">{lineItemsError}</p>}
        </div>
        )}

        {/* Treating / ordering doctor — searchable certified-doctor dropdown */}
        <div className="col-span-2 space-y-2 border-t pt-4">
          <label className="text-sm font-medium">{t('Bestellender / Behandelnder Arzt', 'Ordering / Treating Doctor')}</label>
          <p className="text-xs text-muted-foreground">
            {t(
              'Für welchen Arzt wird dieses Produkt bestellt? Wählen Sie aus der zertifizierten Ärzteliste aus oder geben Sie den Namen manuell ein.',
              'For which certified doctor is this product being ordered? Select from the list or type a name manually.'
            )}
          </p>
          <DoctorCombobox
            value={(form.watch('treatingDoctorName') as string) ?? ''}
            onChange={v => form.setValue('treatingDoctorName', v, { shouldValidate: true })}
            doctors={certifiedDoctors}
            placeholder={t('Name suchen oder eingeben …', 'Search or enter name …')}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">{t('Anmerkungen', 'Notes')}</label>
        <Textarea {...form.register('notes')} />
      </div>

      <div className="flex items-start gap-2 pt-4 border-t">
        <input type="checkbox" id="privacy-new" {...form.register('privacyConsent')} className="mt-1" />
        <label htmlFor="privacy-new" className="text-sm text-muted-foreground">
          {t('Ich stimme der Verarbeitung meiner Daten gemäß der Datenschutzerklärung zu.', 'I agree to the privacy policy.')} *
        </label>
      </div>

      <HumanCheckWidget {...captcha} />

      <Button type="submit" size="lg" className="w-full" disabled={registerCustomer.isPending || !captcha.verified}>
        {registerCustomer.isPending ? t('Sende...', 'Sending...') : t('Registrierung senden', 'Submit Registration')}
      </Button>
    </form>
  );
}
