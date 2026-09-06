import { useState, useRef, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminGet, adminDelete, adminPost, adminRequest } from '@/lib/admin-fetch';
import { EXPENSES_KEY, ORPHAN_SWEEP_STATS_KEY, ORPHAN_SPIKE_SETTINGS_KEY } from '@/lib/query-keys';
import { convertToEUR, PURCHASE_CURRENCIES } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Receipt, Plus, Pencil, Trash2, Eye, Download, Upload,
  Loader2, AlertTriangle, X, FileText, Image as ImageIcon,
  TrendingUp, Euro, Hash, Settings2, FileArchive, ShieldCheck,
  Package, CheckCircle, ChevronDown, ChevronRight, Truck,
  CalendarClock, Pause, Play,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Expense {
  id: number;
  vendor_name: string | null;
  invoice_date: string | null;
  invoice_number: string | null;
  category: string | null;
  net_amount: string | null;
  tax_amount: string | null;
  gross_amount: string | null;
  shipping_cost: string | null;
  currency: string;
  invoice_date_original: string | null;
  date_ambiguous: boolean;
  date_reviewed: boolean;
  net_amount_eur: string | null;
  tax_amount_eur: string | null;
  gross_amount_eur: string | null;
  shipping_cost_eur: string | null;
  exchange_rate: string | null;
  exchange_rate_date: string | null;
  conversion_status: 'not_needed' | 'converted' | 'manual' | 'unavailable';
  source: 'upload' | 'manual';
  file_object_path: string | null;
  notes: string | null;
  created_at: string;
}

interface DuplicateExpenseSummary {
  vendor_name: string | null;
  invoice_date: string | null;
  invoice_number: string | null;
  gross_amount: string | number | null;
  currency: string | null;
}

interface SweepStats {
  scanned:  number;
  deleted:  number;
  errors:   number;
  last_run: string;
}

type RecurringUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';
interface RecurringSchedule {
  id: number; source_expense_id: number; interval_count: number; interval_unit: RecurringUnit; next_due_date: string;
  enabled: boolean; template: Partial<ExpenseFormData>;
}
const RECURRING_UNITS: RecurringUnit[] = ['day', 'week', 'month', 'quarter', 'year'];

function isRecurringUnit(value: unknown): value is RecurringUnit {
  return typeof value === 'string' && RECURRING_UNITS.includes(value as RecurringUnit);
}

function parseRecurringSchedules(value: unknown): RecurringSchedule[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is RecurringSchedule => {
    if (typeof item !== 'object' || item === null) return false;
    const schedule = item as Partial<RecurringSchedule>;
    return typeof schedule.id === 'number'
      && typeof schedule.source_expense_id === 'number'
      && typeof schedule.interval_count === 'number'
      && isRecurringUnit(schedule.interval_unit)
      && typeof schedule.next_due_date === 'string'
      && typeof schedule.enabled === 'boolean'
      && typeof schedule.template === 'object'
      && schedule.template !== null;
  });
}

/** A matched item returned from the extraction endpoint */
export interface MatchedItem {
  product_name:          string | null;
  lot_number:            string | null;
  quantity:              number | null;
  unit_price:            number | null;
  discount_rate:         number | null;
  line_total:            number | null;
  proposed_product_id:   number | null;
  proposed_product_name: string | null;
  proposed_sku:          string | null;
  measurement_original: string | null;
  weight_kg:           number | null;
  length_cm:           number | null;
  width_cm:            number | null;
  height_cm:           number | null;
}

/** A saved item from GET /expenses/:id/items */
interface SavedItem {
  id: number;
  expense_id: number;
  product_name_raw:    string | null;
  product_name_local:  string | null;
  proposed_product_id: number | null;
  proposed_name_de:    string | null;
  proposed_sku:        string | null;
  lot_number:          string | null;
  quantity:            string | null;
  unit_price:          string | null;
  discount_rate:       string | null;
  line_total:          string | null;
  measurement_original: string | null;
  weight_kg:           string | null;
  length_cm:           string | null;
  width_cm:            string | null;
  height_cm:           string | null;
  sort_order:          number;
}

interface ExtractedFields {
  vendor_name:    string | null;
  invoice_date:   string | null;
  invoice_date_original: string | null;
  date_ambiguous: boolean;
  date_reviewed: boolean;
  invoice_number: string | null;
  category:       string | null;
  net_amount:     number | null;
  tax_amount:     number | null;
  gross_amount:   number | null;
  shipping_cost:  number | null;
  currency:       string;
  confidence:     'high' | 'low';
  items:          MatchedItem[];
}

/** Per-row editable state in the form */
interface FormItem {
  product_name_raw:    string;
  product_name_local:  string;
  proposed_product_id: number | null;
  proposed_product_name: string | null;
  proposed_sku:        string | null;
  lot_number:          string;
  quantity:            string;
  unit_price:          string;
  discount_rate:       string;
  line_total:          string;
  measurement_original: string;
  weight_kg:           string;
  length_cm:           string;
  width_cm:            string;
  height_cm:           string;
  /** true when the local name was auto-proposed but not yet accepted/dismissed */
  hasPendingProposal:  boolean;
}

interface ExpenseFormData {
  vendor_name:    string;
  invoice_date:   string;
  invoice_number: string;
  category:       string;
  net_amount:     string;
  tax_amount:     string;
  gross_amount:   string;
  shipping_cost:  string;
  currency:       string;
  invoice_date_original: string;
  date_ambiguous: boolean;
  date_reviewed: boolean;
  net_amount_eur: string;
  tax_amount_eur: string;
  gross_amount_eur: string;
  shipping_cost_eur: string;
  exchange_rate: string;
  exchange_rate_date: string;
  conversion_status: 'not_needed' | 'converted' | 'manual' | 'unavailable';
  notes:          string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  'Office Supplies', 'Software', 'Travel', 'Medical Equipment',
  'Consulting', 'Utilities', 'Advertising', 'Other',
];

const DEFAULT_KONTO_MAP: Record<string, string> = {
  'Office Supplies':   '6815',
  'Software':          '6820',
  'Travel':            '6650',
  'Medical Equipment': '6840',
  'Consulting':        '6800',
  'Utilities':         '6300',
  'Advertising':       '6600',
  'Other':             '6300',
};

const CURRENCIES = PURCHASE_CURRENCIES;

const BLANK_FORM: ExpenseFormData = {
  vendor_name: '', invoice_date: '', invoice_number: '',
  category: '', net_amount: '', tax_amount: '', gross_amount: '',
  shipping_cost: '', currency: 'EUR', invoice_date_original: '', date_ambiguous: false,
  date_reviewed: true,
  net_amount_eur: '', tax_amount_eur: '', gross_amount_eur: '', shipping_cost_eur: '',
  exchange_rate: '1', exchange_rate_date: '', conversion_status: 'not_needed', notes: '',
};

const BLANK_ITEM: FormItem = {
  product_name_raw: '', product_name_local: '',
  proposed_product_id: null, proposed_product_name: null, proposed_sku: null,
  lot_number: '', quantity: '', unit_price: '', discount_rate: '', line_total: '',
  measurement_original: '', weight_kg: '', length_cm: '', width_cm: '', height_cm: '',
  hasPendingProposal: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAmount(v: string | number | null | undefined, currency = 'EUR') {
  if (v === null || v === undefined || v === '') return '–';
  const n = parseFloat(String(v));
  if (isNaN(n)) return '–';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency || 'EUR' }).format(n);
}

function parseDuplicateExpense(value: unknown): DuplicateExpenseSummary | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const summary: DuplicateExpenseSummary = {
    vendor_name: typeof row.vendor_name === 'string' ? row.vendor_name : null,
    invoice_date: typeof row.invoice_date === 'string' ? row.invoice_date : null,
    invoice_number: typeof row.invoice_number === 'string' ? row.invoice_number : null,
    gross_amount: typeof row.gross_amount === 'number' || typeof row.gross_amount === 'string'
      ? row.gross_amount
      : null,
    currency: typeof row.currency === 'string' ? row.currency : null,
  };
  return Object.values(summary).some(value => value !== null && value !== '') ? summary : null;
}

function fmtDuplicateAmount(amount: string | number | null, currency: string | null) {
  if (amount === null || amount === '') return null;
  if (currency && /^[A-Z]{3}$/.test(currency)) return fmtAmount(amount, currency);
  return `${amount}${currency ? ` ${currency}` : ''}`;
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return '–';
  // PostgreSQL date columns can arrive as either YYYY-MM-DD or an ISO
  // timestamp, depending on the query driver/serialization path.  Only append
  // a time component to a date-only value; otherwise it produces an invalid
  // string such as "2026-01-15T00:00:00.000ZT00:00:00Z".
  const dateOnly = d.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  const parsed = new Date(dateOnly ? `${dateOnly}T00:00:00Z` : d);
  if (Number.isNaN(parsed.getTime())) return d;
  // Keep the finance table independent from the browser's selected locale.
  // `toLocaleDateString()` may render mm/dd/yyyy for an English browser even
  // when the app requests German formatting.
  return [
    String(parsed.getUTCDate()).padStart(2, '0'),
    String(parsed.getUTCMonth() + 1).padStart(2, '0'),
    String(parsed.getUTCFullYear()),
  ].join('.');
}

async function uploadToStorage(file: File, token: string): Promise<string> {
  const meta = await adminPost<{ uploadURL: string; objectPath: string }>(
    '/api/admin/expenses/upload-url',
    token,
    { name: file.name, size: file.size, contentType: file.type },
  );

  await fetch(meta.uploadURL, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  }).then(r => { if (!r.ok) throw new Error('gcs-put-failed'); });

  const suffix = (meta.objectPath as string).replace(/^\/objects\//, '');
  return `/objects/${suffix}`;
}

function matchedItemToForm(item: MatchedItem): FormItem {
  const hasMismatch = item.proposed_product_name !== null
    && item.product_name !== null
    && item.proposed_product_name.toLowerCase() !== item.product_name.toLowerCase();

  return {
    product_name_raw:     item.product_name ?? '',
    // When a match is found, pre-fill local name with proposal; admin can change it
    product_name_local:   item.proposed_product_name ?? item.product_name ?? '',
    proposed_product_id:  item.proposed_product_id,
    proposed_product_name: item.proposed_product_name,
    proposed_sku:         item.proposed_sku,
    lot_number:           item.lot_number ?? '',
    quantity:             item.quantity != null ? String(item.quantity) : '',
    unit_price:           item.unit_price != null ? String(item.unit_price) : '',
    discount_rate:        item.discount_rate != null ? String(item.discount_rate) : '',
    line_total:           item.line_total != null ? String(item.line_total) : '',
    measurement_original: item.measurement_original ?? '',
    weight_kg:            item.weight_kg != null ? String(item.weight_kg) : '',
    length_cm:            item.length_cm != null ? String(item.length_cm) : '',
    width_cm:             item.width_cm != null ? String(item.width_cm) : '',
    height_cm:            item.height_cm != null ? String(item.height_cm) : '',
    hasPendingProposal:   hasMismatch,
  };
}

function savedItemToForm(item: SavedItem): FormItem {
  return {
    product_name_raw:     item.product_name_raw  ?? '',
    product_name_local:   item.product_name_local ?? item.product_name_raw ?? '',
    proposed_product_id:  item.proposed_product_id,
    proposed_product_name: item.proposed_name_de,
    proposed_sku:         item.proposed_sku,
    lot_number:           item.lot_number  ?? '',
    quantity:             item.quantity    != null ? String(parseFloat(item.quantity))    : '',
    unit_price:           item.unit_price  != null ? String(parseFloat(item.unit_price))  : '',
    discount_rate:        item.discount_rate != null ? String(parseFloat(item.discount_rate)) : '',
    line_total:           item.line_total  != null ? String(parseFloat(item.line_total))  : '',
    measurement_original: item.measurement_original ?? '',
    weight_kg:            item.weight_kg != null ? String(parseFloat(item.weight_kg)) : '',
    length_cm:            item.length_cm != null ? String(parseFloat(item.length_cm)) : '',
    width_cm:             item.width_cm != null ? String(parseFloat(item.width_cm)) : '',
    height_cm:            item.height_cm != null ? String(parseFloat(item.height_cm)) : '',
    hasPendingProposal:   false,
  };
}

function extractedToForm(e: ExtractedFields): ExpenseFormData {
  return {
    vendor_name:    e.vendor_name    ?? '',
    invoice_date:   e.invoice_date   ?? '',
    invoice_date_original: e.invoice_date_original ?? '',
    date_ambiguous: e.date_ambiguous === true,
    date_reviewed: e.date_ambiguous !== true,
    invoice_number: e.invoice_number ?? '',
    category:       e.category       ?? '',
    net_amount:     e.net_amount    != null ? String(e.net_amount)    : '',
    tax_amount:     e.tax_amount    != null ? String(e.tax_amount)    : '',
    gross_amount:   e.gross_amount  != null ? String(e.gross_amount)  : '',
    shipping_cost:  e.shipping_cost != null ? String(e.shipping_cost) : '',
    currency:       e.currency || 'EUR',
    net_amount_eur: e.currency === 'EUR' ? (e.net_amount != null ? String(e.net_amount) : '') : '',
    tax_amount_eur: e.currency === 'EUR' ? (e.tax_amount != null ? String(e.tax_amount) : '') : '',
    gross_amount_eur: e.currency === 'EUR' ? (e.gross_amount != null ? String(e.gross_amount) : '') : '',
    shipping_cost_eur: e.currency === 'EUR' ? (e.shipping_cost != null ? String(e.shipping_cost) : '') : '',
    exchange_rate: e.currency === 'EUR' ? '1' : '',
    exchange_rate_date: '',
    conversion_status: e.currency === 'EUR' ? 'not_needed' : 'unavailable',
    notes: '',
  };
}

function expenseToForm(e: Expense): ExpenseFormData {
  return {
    vendor_name:    e.vendor_name    ?? '',
    invoice_date:   e.invoice_date ? e.invoice_date.slice(0, 10) : '',
    invoice_date_original: e.invoice_date_original ?? '',
    date_ambiguous: false,
    date_reviewed: e.date_reviewed ?? true,
    invoice_number: e.invoice_number ?? '',
    category:       e.category       ?? '',
    net_amount:     e.net_amount    != null ? String(parseFloat(e.net_amount))    : '',
    tax_amount:     e.tax_amount    != null ? String(parseFloat(e.tax_amount))    : '',
    gross_amount:   e.gross_amount  != null ? String(parseFloat(e.gross_amount))  : '',
    shipping_cost:  e.shipping_cost != null ? String(parseFloat(e.shipping_cost)) : '',
    currency:       e.currency || 'EUR',
    net_amount_eur: e.net_amount_eur != null ? String(parseFloat(e.net_amount_eur)) : '',
    tax_amount_eur: e.tax_amount_eur != null ? String(parseFloat(e.tax_amount_eur)) : '',
    gross_amount_eur: e.gross_amount_eur != null ? String(parseFloat(e.gross_amount_eur)) : '',
    shipping_cost_eur: e.shipping_cost_eur != null ? String(parseFloat(e.shipping_cost_eur)) : '',
    exchange_rate: e.exchange_rate != null ? String(parseFloat(e.exchange_rate)) : '',
    exchange_rate_date: e.exchange_rate_date?.slice(0, 10) ?? '',
    conversion_status: e.conversion_status ?? (e.currency === 'EUR' ? 'not_needed' : 'unavailable'),
    notes:          e.notes ?? '',
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</Label>
      {children}
    </div>
  );
}

const inputCls = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface ExpenseFormProps {
  lang: string;
  data: ExpenseFormData;
  onChange: (data: ExpenseFormData) => void;
  onRefreshConversion?: () => void;
  converting?: boolean;
}

function ExpenseFormFields({ lang, data, onChange, onRefreshConversion, converting }: ExpenseFormProps) {
  const set = (k: keyof ExpenseFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const sourceWasChanged = data.currency !== 'EUR'
        && ['net_amount', 'tax_amount', 'gross_amount', 'shipping_cost', 'invoice_date'].includes(k);
      onChange({
        ...data,
        [k]: e.target.value,
        ...(sourceWasChanged ? {
          net_amount_eur: '', tax_amount_eur: '', gross_amount_eur: '', shipping_cost_eur: '',
          exchange_rate: '', exchange_rate_date: '', conversion_status: 'unavailable' as const,
        } : {}),
        conversion_status: sourceWasChanged ? 'unavailable' : (data.currency !== 'EUR'
          && ['net_amount_eur', 'tax_amount_eur', 'gross_amount_eur', 'shipping_cost_eur', 'exchange_rate', 'exchange_rate_date'].includes(k)
          ? 'manual'
          : data.conversion_status),
      });
    };

  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField label={lang === 'de' ? 'Anbieter / Unternehmen' : 'Vendor / Business'}>
        <input className={inputCls} value={data.vendor_name} onChange={set('vendor_name')} placeholder="ACME GmbH" />
      </FormField>
      <FormField label={lang === 'de' ? 'Rechnungsdatum' : 'Invoice Date'}>
        <input className={inputCls} type="date" value={data.invoice_date} onChange={set('invoice_date')} />
      </FormField>
      {data.invoice_date_original && (
        <div className="col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>{lang === 'de' ? 'Datum auf dem Original:' : 'Date on source:'}</strong> {data.invoice_date_original}
          {data.date_ambiguous && (
            <label className="mt-2 flex items-center gap-2 font-semibold">
              <input type="checkbox" checked={data.date_reviewed} onChange={e => onChange({ ...data, date_reviewed: e.target.checked })} />
              {lang === 'de' ? 'Ich habe das uneindeutige Datum geprüft.' : 'I have reviewed the ambiguous date.'}
            </label>
          )}
        </div>
      )}
      <FormField label={lang === 'de' ? 'Rechnungsnummer' : 'Invoice Number'}>
        <input className={inputCls} value={data.invoice_number} onChange={set('invoice_number')} placeholder="INV-2024-001" />
      </FormField>
      <FormField label={lang === 'de' ? 'Kategorie' : 'Category'}>
        <select className={inputCls} value={data.category} onChange={set('category')}>
          <option value="">{lang === 'de' ? '– Bitte wählen –' : '– Select –'}</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </FormField>
      <FormField label={lang === 'de' ? 'Nettobetrag' : 'Net Amount'}>
        <input className={inputCls} type="number" step="0.01" min="0" value={data.net_amount} onChange={set('net_amount')} placeholder="0.00" />
      </FormField>
      <FormField label={lang === 'de' ? 'MwSt.-Betrag' : 'Tax / VAT Amount'}>
        <input className={inputCls} type="number" step="0.01" min="0" value={data.tax_amount} onChange={set('tax_amount')} placeholder="0.00" />
      </FormField>
      <FormField label={lang === 'de' ? 'Bruttobetrag' : 'Gross Amount'}>
        <input className={inputCls} type="number" step="0.01" min="0" value={data.gross_amount} onChange={set('gross_amount')} placeholder="0.00" />
      </FormField>
      <FormField label={lang === 'de' ? 'Versandkosten' : 'Shipping Cost'}>
        <div className="relative">
          <Truck className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <input className={`${inputCls} pl-8`} type="number" step="0.01" min="0" value={data.shipping_cost} onChange={set('shipping_cost')} placeholder="0.00" />
        </div>
      </FormField>
      <FormField label={lang === 'de' ? 'Währung' : 'Currency'}>
        <select className={inputCls} value={data.currency} onChange={e => onChange({
          ...data,
          currency: e.target.value,
          net_amount_eur: e.target.value === 'EUR' ? data.net_amount : '',
          tax_amount_eur: e.target.value === 'EUR' ? data.tax_amount : '',
          gross_amount_eur: e.target.value === 'EUR' ? data.gross_amount : '',
          shipping_cost_eur: e.target.value === 'EUR' ? data.shipping_cost : '',
          exchange_rate: e.target.value === 'EUR' ? '1' : '',
          exchange_rate_date: '',
          conversion_status: e.target.value === 'EUR' ? 'not_needed' : 'unavailable',
        })}>
          {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </FormField>
      <div className="col-span-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-blue-950">{lang === 'de' ? 'EUR-Umrechnung (Snapshot)' : 'EUR conversion snapshot'}</p>
            <p className="text-xs text-muted-foreground">
              {data.currency === 'EUR'
                ? (lang === 'de' ? 'Originalwerte in EUR.' : 'Source values are already EUR.')
                : (lang === 'de' ? 'Quellwerte bleiben unverändert; diese Werte gehen in die Buchhaltung.' : 'Source values stay unchanged; these values are used for accounting.')}
            </p>
          </div>
          {data.currency !== 'EUR' && onRefreshConversion && (
            <Button type="button" variant="outline" size="sm" onClick={onRefreshConversion} disabled={converting} className="shrink-0">
              {converting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {lang === 'de' ? 'Aktuellen Kurs laden' : 'Get current rate'}
            </Button>
          )}
        </div>
        {data.conversion_status === 'unavailable' && data.currency !== 'EUR' && (
          <p className="text-xs text-amber-700">
            {lang === 'de' ? 'Kein Kurs gespeichert. Bitte laden oder EUR-Werte manuell eintragen.' : 'No rate saved. Load a rate or enter EUR values manually.'}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FormField label={lang === 'de' ? 'Netto (EUR)' : 'Net (EUR)'}><input className={inputCls} type="number" step="0.01" min="0" value={data.net_amount_eur} onChange={set('net_amount_eur')} /></FormField>
          <FormField label={lang === 'de' ? 'MwSt. (EUR)' : 'VAT (EUR)'}><input className={inputCls} type="number" step="0.01" min="0" value={data.tax_amount_eur} onChange={set('tax_amount_eur')} /></FormField>
          <FormField label={lang === 'de' ? 'Brutto (EUR)' : 'Gross (EUR)'}><input className={inputCls} type="number" step="0.01" min="0" value={data.gross_amount_eur} onChange={set('gross_amount_eur')} /></FormField>
          <FormField label={lang === 'de' ? 'Versand (EUR)' : 'Shipping (EUR)'}><input className={inputCls} type="number" step="0.01" min="0" value={data.shipping_cost_eur} onChange={set('shipping_cost_eur')} /></FormField>
          <FormField label={lang === 'de' ? 'Kurs (1 Quelle = EUR)' : 'Rate (1 source = EUR)'}><input className={inputCls} type="number" step="0.000001" min="0" value={data.exchange_rate} onChange={set('exchange_rate')} /></FormField>
          <FormField label={lang === 'de' ? 'Kursdatum' : 'Rate date'}><input className={inputCls} type="date" value={data.exchange_rate_date} onChange={set('exchange_rate_date')} /></FormField>
        </div>
      </div>
      <div className="col-span-2">
        <FormField label={lang === 'de' ? 'Notizen (optional)' : 'Notes (optional)'}>
          <textarea
            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            value={data.notes}
            onChange={set('notes')}
            rows={2}
          />
        </FormField>
      </div>
    </div>
  );
}

// ── Line Items Section ────────────────────────────────────────────────────────

interface LineItemsSectionProps {
  lang: string;
  items: FormItem[];
  onChange: (items: FormItem[]) => void;
}

function LineItemsSection({ lang, items, onChange }: LineItemsSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  const updateItem = (idx: number, patch: Partial<FormItem>) => {
    onChange(items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };

  const removeItem = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const addItem = () => {
    onChange([...items, { ...BLANK_ITEM }]);
  };

  const acceptProposal = (idx: number) => {
    const it = items[idx];
    if (!it.proposed_product_name) return;
    updateItem(idx, { product_name_local: it.proposed_product_name, hasPendingProposal: false });
  };

  const dismissProposal = (idx: number) => {
    updateItem(idx, { hasPendingProposal: false });
  };

  // Recompute line total when qty / unit_price / discount change
  const recomputeTotal = (idx: number, patch: Partial<FormItem>) => {
    const it = { ...items[idx], ...patch };
    const qty  = parseFloat(it.quantity)   || 0;
    const up   = parseFloat(it.unit_price) || 0;
    const disc = parseFloat(it.discount_rate) || 0;
    if (qty > 0 && up > 0) {
      const total = qty * up * (1 - disc / 100);
      updateItem(idx, { ...patch, line_total: total.toFixed(2) });
    } else {
      updateItem(idx, patch);
    }
  };

  const hasPending = items.some(it => it.hasPendingProposal);

  return (
    <div className="border rounded-xl overflow-hidden">
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">
            {lang === 'de' ? 'Positionen' : 'Line Items'}
            {items.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">({items.length})</span>
            )}
          </span>
          {hasPending && (
            <span className="ml-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              {lang === 'de' ? 'Vorschläge ausstehend' : 'Proposals pending'}
            </span>
          )}
        </div>
        {collapsed ? <ChevronRight className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="p-4 space-y-3">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">
              {lang === 'de' ? 'Noch keine Positionen. Klicke zum Hinzufügen.' : 'No items yet. Click to add.'}
            </p>
          ) : (
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={idx} className="border rounded-lg p-3 space-y-2 bg-card">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground w-5 shrink-0">#{idx + 1}</span>

                    {/* Product name raw (from invoice) */}
                    <div className="flex-1 min-w-0">
                      <label className="text-xs text-muted-foreground block mb-0.5">
                        {lang === 'de' ? 'Name (Rechnung)' : 'Name (invoice)'}
                      </label>
                      <input
                        className={`${inputCls} h-8 text-xs`}
                        value={item.product_name_raw}
                        onChange={e => updateItem(idx, { product_name_raw: e.target.value })}
                        placeholder={lang === 'de' ? 'Produktname laut Rechnung' : 'Product name from invoice'}
                      />
                    </div>

                    {/* Local product name */}
                    <div className="flex-1 min-w-0">
                      <label className="text-xs text-muted-foreground block mb-0.5">
                        {lang === 'de' ? 'Lokaler Name' : 'Local name'}
                      </label>
                      <input
                        className={`${inputCls} h-8 text-xs ${item.hasPendingProposal ? 'border-amber-400 bg-amber-50' : ''}`}
                        value={item.product_name_local}
                        onChange={e => updateItem(idx, { product_name_local: e.target.value, hasPendingProposal: false })}
                        placeholder={lang === 'de' ? 'Lokaler Produktname' : 'Local product name'}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="shrink-0 text-muted-foreground hover:text-destructive p-1 rounded"
                      title={lang === 'de' ? 'Entfernen' : 'Remove'}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Proposal banner */}
                  {item.hasPendingProposal && item.proposed_product_name && (
                    <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="text-amber-800 flex-1">
                        {lang === 'de'
                          ? `Mögliche Übereinstimmung: `
                          : `Possible match: `}
                        <strong>{item.proposed_product_name}</strong>
                        {item.proposed_sku && <span className="ml-1 font-mono text-amber-600">({item.proposed_sku})</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => acceptProposal(idx)}
                        className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-2 py-0.5 rounded font-medium"
                      >
                        <CheckCircle className="w-3 h-3" />
                        {lang === 'de' ? 'Übernehmen' : 'Accept'}
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissProposal(idx)}
                        className="text-amber-600 hover:text-amber-800"
                        title={lang === 'de' ? 'Verwerfen' : 'Dismiss'}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  {/* Numeric fields */}
                  <div className="grid grid-cols-5 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">
                        {lang === 'de' ? 'Lot-Nr.' : 'Lot #'}
                      </label>
                      <input
                        className={`${inputCls} h-7 text-xs font-mono`}
                        value={item.lot_number}
                        onChange={e => updateItem(idx, { lot_number: e.target.value })}
                        placeholder="LOT123"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">
                        {lang === 'de' ? 'Menge' : 'Qty'}
                      </label>
                      <input
                        className={`${inputCls} h-7 text-xs`}
                        type="number" step="0.001" min="0"
                        value={item.quantity}
                        onChange={e => recomputeTotal(idx, { quantity: e.target.value })}
                        placeholder="1"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">
                        {lang === 'de' ? 'Preis/Stk.' : 'Unit price'}
                      </label>
                      <input
                        className={`${inputCls} h-7 text-xs`}
                        type="number" step="0.01" min="0"
                        value={item.unit_price}
                        onChange={e => recomputeTotal(idx, { unit_price: e.target.value })}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">
                        {lang === 'de' ? 'Rabatt %' : 'Discount %'}
                      </label>
                      <input
                        className={`${inputCls} h-7 text-xs`}
                        type="number" step="0.01" min="0" max="100"
                        value={item.discount_rate}
                        onChange={e => recomputeTotal(idx, { discount_rate: e.target.value })}
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">
                        {lang === 'de' ? 'Gesamt' : 'Total'}
                      </label>
                      <input
                        className={`${inputCls} h-7 text-xs font-semibold`}
                        type="number" step="0.01" min="0"
                        value={item.line_total}
                        onChange={e => updateItem(idx, { line_total: e.target.value })}
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-2 border-t pt-2">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">{lang === 'de' ? 'Maß Original' : 'Source measure'}</label>
                      <input className={`${inputCls} h-7 text-xs`} value={item.measurement_original} onChange={e => updateItem(idx, { measurement_original: e.target.value })} placeholder="2 lb · 8 × 4 in" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">{lang === 'de' ? 'Gewicht kg' : 'Weight kg'}</label>
                      <input className={`${inputCls} h-7 text-xs`} type="number" step="0.001" min="0" value={item.weight_kg} onChange={e => updateItem(idx, { weight_kg: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">{lang === 'de' ? 'Länge cm' : 'Length cm'}</label>
                      <input className={`${inputCls} h-7 text-xs`} type="number" step="0.01" min="0" value={item.length_cm} onChange={e => updateItem(idx, { length_cm: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">{lang === 'de' ? 'Breite cm' : 'Width cm'}</label>
                      <input className={`${inputCls} h-7 text-xs`} type="number" step="0.01" min="0" value={item.width_cm} onChange={e => updateItem(idx, { width_cm: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">{lang === 'de' ? 'Höhe cm' : 'Height cm'}</label>
                      <input className={`${inputCls} h-7 text-xs`} type="number" step="0.01" min="0" value={item.height_cm} onChange={e => updateItem(idx, { height_cm: e.target.value })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button type="button" variant="outline" size="sm" onClick={addItem} className="w-full gap-1.5 h-8 text-xs">
            <Plus className="w-3.5 h-3.5" />
            {lang === 'de' ? 'Position hinzufügen' : 'Add line item'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Expenses() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Filters
  const [filterFrom, setFilterFrom]     = useState('');
  const [filterTo, setFilterTo]         = useState('');
  const [filterCat, setFilterCat]       = useState('');
  const [filterVendor, setFilterVendor] = useState('');

  // Upload / extraction state
  const [uploadState, setUploadState]       = useState<'idle' | 'uploading' | 'extracting'>('idle');
  const [extractWarning, setExtractWarning] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver]         = useState(false);

  // Confirmation / edit modal
  const [modalMode, setModalMode]           = useState<'none' | 'confirm' | 'manual' | 'edit'>('none');
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);
  const [formData, setFormData]             = useState<ExpenseFormData>(BLANK_FORM);
  const [formItems, setFormItems]           = useState<FormItem[]>([]);
  const [editingId, setEditingId]           = useState<number | null>(null);
  const [saving, setSaving]                 = useState(false);
  const [saveError, setSaveError]           = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [duplicateExpense, setDuplicateExpense] = useState<DuplicateExpenseSummary | null>(null);
  const [loadingItems, setLoadingItems]     = useState(false);
  const [converting, setConverting]         = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState('1');
  const [recurrenceUnit, setRecurrenceUnit] = useState<RecurringUnit>('month');
  const [recurrenceStartDate, setRecurrenceStartDate] = useState('');

  const applyCurrentConversion = useCallback(async (source: ExpenseFormData) => {
    const sourceSignature = `${source.currency}|${source.invoice_date}|${source.net_amount}|${source.tax_amount}|${source.gross_amount}|${source.shipping_cost}`;
    if (source.currency === 'EUR') {
      const eurData = {
        ...source,
        net_amount_eur: source.net_amount,
        tax_amount_eur: source.tax_amount,
        gross_amount_eur: source.gross_amount,
        shipping_cost_eur: source.shipping_cost,
        exchange_rate: '1',
        exchange_rate_date: source.exchange_rate_date || new Date().toISOString().slice(0, 10),
        conversion_status: 'not_needed' as const,
      };
      setFormData(current => current.currency === source.currency ? eurData : current);
      return;
    }
    const values = [source.gross_amount, source.net_amount, source.tax_amount, source.shipping_cost]
      .map(value => parseFloat(value))
      .filter(value => Number.isFinite(value) && value > 0);
    if (values.length === 0) {
      setFormData(current => `${current.currency}|${current.invoice_date}|${current.net_amount}|${current.tax_amount}|${current.gross_amount}|${current.shipping_cost}` === sourceSignature
        ? { ...current, conversion_status: 'unavailable' }
        : current);
      return;
    }
    setConverting(true);
    const result = await convertToEUR(values[0], source.currency, 'latest');
    setConverting(false);
    if (!result) {
      setFormData(current => `${current.currency}|${current.invoice_date}|${current.net_amount}|${current.tax_amount}|${current.gross_amount}|${current.shipping_cost}` === sourceSignature
        ? { ...current, conversion_status: 'unavailable' }
        : current);
      toast({
        variant: 'destructive',
        title: lang === 'de' ? 'Wechselkurs nicht verfügbar' : 'Exchange rate unavailable',
        description: lang === 'de' ? 'Bitte EUR-Werte manuell eintragen.' : 'Please enter the EUR values manually.',
      });
      return;
    }
    const toEur = (value: string) => {
      const number = parseFloat(value);
      return Number.isFinite(number) ? (Math.round(number * result.rate * 100) / 100).toFixed(2) : '';
    };
    setFormData(current => `${current.currency}|${current.invoice_date}|${current.net_amount}|${current.tax_amount}|${current.gross_amount}|${current.shipping_cost}` === sourceSignature
      ? {
          ...current,
          net_amount_eur: toEur(source.net_amount),
          tax_amount_eur: toEur(source.tax_amount),
          gross_amount_eur: toEur(source.gross_amount),
          shipping_cost_eur: toEur(source.shipping_cost),
          exchange_rate: String(result.rate),
          exchange_rate_date: result.rateDate,
          conversion_status: 'converted',
        }
      : current);
  }, [lang, toast]);

  const refreshConversion = useCallback(() => applyCurrentConversion(formData), [applyCurrentConversion, formData]);

  // ── Amount consistency check ──────────────────────────────────────────────────
  const amountMismatchWarning = (() => {
    const net   = formData.net_amount   !== '' ? parseFloat(formData.net_amount)   : null;
    const tax   = formData.tax_amount   !== '' ? parseFloat(formData.tax_amount)   : null;
    const gross = formData.gross_amount !== '' ? parseFloat(formData.gross_amount) : null;
    if (net === null || tax === null || gross === null) return null;
    if (isNaN(net) || isNaN(tax) || isNaN(gross)) return null;
    if (Math.round(Math.abs(gross - (net + tax)) * 100) > 2) {
      const expected = (net + tax).toFixed(2);
      return lang === 'de'
        ? `Betragsinkonsistenz: Netto (${net.toFixed(2)}) + MwSt. (${tax.toFixed(2)}) = ${expected}, aber Brutto ist ${gross.toFixed(2)}. Bitte prüfen.`
        : `Amount mismatch: Net (${net.toFixed(2)}) + Tax (${tax.toFixed(2)}) = ${expected}, but Gross is ${gross.toFixed(2)}. Please review.`;
    }
    return null;
  })();

  // Data
  const params = new URLSearchParams();
  if (filterFrom)   params.set('from', filterFrom);
  if (filterTo)     params.set('to', filterTo);
  if (filterCat)    params.set('category', filterCat);
  if (filterVendor) params.set('vendor', filterVendor);

  const { data: expenses = [], isLoading } = useQuery<Expense[]>({
    queryKey: [...EXPENSES_KEY, filterFrom, filterTo, filterCat, filterVendor],
    queryFn: () => adminGet<Expense[]>(`/api/admin/expenses?${params.toString()}`, token!),
    enabled: !!token,
  });
  const {
    data: recurringSchedules = [],
    isError: recurringSchedulesError,
    isFetching: recurringSchedulesFetching,
  } = useQuery<RecurringSchedule[]>({
    queryKey: ['recurring-expense-schedules'],
    queryFn: async () => parseRecurringSchedules(
      await adminGet<unknown>('/api/admin/expenses/recurring-schedules', token!),
    ),
    enabled: !!token,
  });
  const [retryingRecurringSchedules, setRetryingRecurringSchedules] = useState(false);
  const [recurringScheduleRetryFailed, setRecurringScheduleRetryFailed] = useState(false);
  const retryRecurringSchedules = async () => {
    if (retryingRecurringSchedules || recurringSchedulesFetching) return;
    setRetryingRecurringSchedules(true);
    setRecurringScheduleRetryFailed(false);
    try {
      const schedules = parseRecurringSchedules(
        await adminGet<unknown>('/api/admin/expenses/recurring-schedules', token!),
      );
      qc.setQueryData(['recurring-expense-schedules'], schedules);
    } catch {
      setRecurringScheduleRetryFailed(true);
    } finally {
      setRetryingRecurringSchedules(false);
    }
  };

  const { data: sweepStats } = useQuery<SweepStats | null>({
    queryKey: ORPHAN_SWEEP_STATS_KEY,
    queryFn: async () => {
      const res = await adminRequest('/api/admin/expenses/orphan-sweep-stats', token!);
      if (res.status === 204) return null;
      if (!res.ok) throw new Error('Failed to fetch sweep stats');
      return res.json() as Promise<SweepStats>;
    },
    enabled: !!token,
    staleTime: 60_000,
  });

  const { data: spikeSettings } = useQuery<{ threshold: number }>({
    queryKey: ORPHAN_SPIKE_SETTINGS_KEY,
    queryFn: () => adminGet<{ threshold: number }>('/api/admin/expenses/orphan-spike-settings', token!),
    enabled: !!token,
    staleTime: 5 * 60_000,
  });

  const [editingThreshold, setEditingThreshold] = useState(false);
  const [thresholdInput, setThresholdInput]     = useState('');
  const [savingThreshold, setSavingThreshold]   = useState(false);

  const spikeThreshold = spikeSettings?.threshold ?? 5;
  const isSpike        = sweepStats != null && sweepStats.deleted > spikeThreshold;

  const saveThreshold = async () => {
    const n = parseInt(thresholdInput, 10);
    if (isNaN(n) || n < 0) return;
    setSavingThreshold(true);
    try {
      await adminRequest('/api/admin/expenses/orphan-spike-settings', token!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold: n }),
      });
      qc.invalidateQueries({ queryKey: ORPHAN_SPIKE_SETTINGS_KEY });
      setEditingThreshold(false);
    } catch {
      // ignore – stale value remains
    } finally {
      setSavingThreshold(false);
    }
  };

  // ── Summary cards ─────────────────────────────────────────────────────────────
  const totalGross = expenses.reduce((s, e) => s + (parseFloat(e.gross_amount_eur ?? (e.currency === 'EUR' ? e.gross_amount ?? '0' : '0')) || 0), 0);
  const totalVat   = expenses.reduce((s, e) => s + (parseFloat(e.tax_amount_eur ?? (e.currency === 'EUR' ? e.tax_amount ?? '0' : '0')) || 0), 0);
  const eurCount   = expenses.filter(e => e.currency === 'EUR').length;
  const displayCurrency = 'EUR';

  // ── File handling ──────────────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    if (!token) return;

    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Nicht unterstütztes Format' : 'Unsupported format', description: 'PDF, PNG, JPEG' });
      return;
    }
    if (file.size < 64) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Datei scheint leer zu sein' : 'File appears to be empty' });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Datei zu groß (max. 20 MB)' : 'File too large (max 20 MB)' });
      return;
    }

    setExtractWarning('');
    setUploadState('uploading');
    let fileObjectPath: string;
    try {
      fileObjectPath = await uploadToStorage(file, token);
    } catch {
      setUploadState('idle');
      toast({ variant: 'destructive', title: lang === 'de' ? 'Upload fehlgeschlagen' : 'Upload failed' });
      return;
    }

    setUploadState('extracting');
    try {
      const extractRes = await adminRequest('/api/admin/expenses/extract', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileObjectPath, mimeType: file.type }),
      });

      if (!extractRes.ok) {
        let serverMsg = '';
        try { serverMsg = ((await extractRes.json()) as { error?: string }).error ?? ''; } catch { /* ignore */ }

        if (extractRes.status === 422) {
          setUploadState('idle');
          toast({
            variant: 'destructive',
            title: lang === 'de' ? 'Datei konnte nicht gelesen werden' : 'File could not be read',
            description: serverMsg || (lang === 'de'
              ? 'Die Datei konnte nicht aus dem Speicher abgerufen werden. Bitte erneut hochladen.'
              : 'The file could not be retrieved from storage. Please upload again.'),
          });
          return;
        }

        setExtractWarning(serverMsg || (lang === 'de'
          ? 'KI-Extraktion fehlgeschlagen. Bitte Felder manuell ausfüllen.'
          : 'AI extraction failed. Please fill in the fields manually.'));
        setPendingFilePath(fileObjectPath);
        setFormData(BLANK_FORM);
        setFormItems([]);
        setModalMode('confirm');
        return;
      }

      const result = await extractRes.json() as {
        fileObjectPath: string;
        extracted: ExtractedFields;
        parseError?: string;
      };

      if (result.parseError || result.extracted.confidence === 'low') {
        setExtractWarning(result.parseError ?? (lang === 'de'
          ? 'Niedrige Erkennungsgenauigkeit — bitte Felder überprüfen und korrigieren.'
          : 'Low extraction confidence — please review and correct the fields below.'));
      }
      setPendingFilePath(result.fileObjectPath);
      const extractedForm = extractedToForm(result.extracted);
      setFormData(extractedForm);
      void applyCurrentConversion(extractedForm);
      setFormItems((result.extracted.items ?? []).map(matchedItemToForm));
      setModalMode('confirm');
    } catch {
      setExtractWarning(lang === 'de'
        ? 'KI-Extraktion fehlgeschlagen. Bitte Felder manuell ausfüllen.'
        : 'AI extraction failed. Please fill in the fields manually.');
      setPendingFilePath(fileObjectPath!);
      setFormData(BLANK_FORM);
      setFormItems([]);
      setModalMode('confirm');
    } finally {
      setUploadState('idle');
    }
  }, [token, lang, toast, applyCurrentConversion]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  // ── Save / update ──────────────────────────────────────────────────────────────

  const handleSave = async (skipDuplicateCheck = false) => {
    if (!token) return;

    const hasVendor  = formData.vendor_name.trim() !== '';
    const hasDate    = formData.invoice_date.trim() !== '';
    const hasAmount  = formData.gross_amount.trim() !== ''
                    || formData.net_amount.trim()   !== ''
                    || formData.tax_amount.trim()   !== '';
    if (!hasVendor && !hasDate && !hasAmount) {
      setSaveError(lang === 'de'
        ? 'Bitte mindestens einen Anbieter, ein Datum oder einen Betrag angeben.'
        : 'Please enter at least a vendor, a date, or an amount before saving.');
      return;
    }
    setSaveError('');
    // Do not leave an old duplicate warning in place while a new submission is
    // in progress. A new 409 below installs fresh duplicate details; any
    // other failure is represented by saveError in the footer.
    setDuplicateWarning(null);
    setDuplicateExpense(null);

    // Serialize items for the API
    const items = formItems.map((it, idx) => ({
      product_name_raw:    it.product_name_raw    || null,
      product_name_local:  it.product_name_local  || null,
      proposed_product_id: it.proposed_product_id,
      lot_number:          it.lot_number           || null,
      quantity:            it.quantity    ? parseFloat(it.quantity)    : null,
      unit_price:          it.unit_price  ? parseFloat(it.unit_price)  : null,
      discount_rate:       it.discount_rate ? parseFloat(it.discount_rate) : null,
      line_total:          it.line_total  ? parseFloat(it.line_total)  : null,
      measurement_original: it.measurement_original || null,
      weight_kg:           it.weight_kg ? parseFloat(it.weight_kg) : null,
      length_cm:           it.length_cm ? parseFloat(it.length_cm) : null,
      width_cm:            it.width_cm ? parseFloat(it.width_cm) : null,
      height_cm:           it.height_cm ? parseFloat(it.height_cm) : null,
      sort_order:          idx,
    }));

    setSaving(true);
    try {
      const body = {
        ...formData,
        net_amount:    formData.net_amount    ? parseFloat(formData.net_amount)    : null,
        tax_amount:    formData.tax_amount    ? parseFloat(formData.tax_amount)    : null,
        gross_amount:  formData.gross_amount  ? parseFloat(formData.gross_amount)  : null,
        shipping_cost: formData.shipping_cost ? parseFloat(formData.shipping_cost) : null,
        net_amount_eur: formData.net_amount_eur ? parseFloat(formData.net_amount_eur) : null,
        tax_amount_eur: formData.tax_amount_eur ? parseFloat(formData.tax_amount_eur) : null,
        gross_amount_eur: formData.gross_amount_eur ? parseFloat(formData.gross_amount_eur) : null,
        shipping_cost_eur: formData.shipping_cost_eur ? parseFloat(formData.shipping_cost_eur) : null,
        exchange_rate: formData.exchange_rate ? parseFloat(formData.exchange_rate) : null,
        exchange_rate_date: formData.exchange_rate_date || null,
        conversion_status: formData.conversion_status,
        vendor_name:    formData.vendor_name    || null,
        invoice_date:   formData.invoice_date   || null,
        invoice_date_original: formData.invoice_date_original || null,
        invoice_number: formData.invoice_number || null,
        category:       formData.category       || null,
        notes:          formData.notes          || null,
        source: pendingFilePath ? 'upload' : 'manual',
        file_object_path: pendingFilePath ?? null,
        items,
        ...(skipDuplicateCheck ? { skipDuplicateCheck: true } : {}),
      };

      if (modalMode === 'edit' && editingId !== null) {
        const res = await adminRequest(`/api/admin/expenses/${editingId}`, token, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({})) as { error?: string };
          setSaveError(json.error ?? `HTTP ${res.status}`);
          return;
        }
        toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
      } else {
        const res = await adminRequest('/api/admin/expenses', token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (res.status === 409) {
          const json = await res.json() as { message?: unknown; duplicate?: unknown };
          setDuplicateExpense(parseDuplicateExpense(json.duplicate));
          setDuplicateWarning(
            (typeof json.message === 'string' && json.message.length > 0
              ? json.message
              : undefined)
              ?? (lang === 'de'
                ? 'Ein ähnlicher Eintrag existiert bereits. Trotzdem speichern?'
                : 'A similar expense already exists. Save anyway?'),
          );
          return;
        }
        if (!res.ok) {
          const json = await res.json().catch(() => ({})) as { error?: string };
          setSaveError(json.error ?? `HTTP ${res.status}`);
          return;
        }
        const created = await res.json() as { id: number };
        if (recurrenceInterval) {
          const scheduleRes = await adminRequest('/api/admin/expenses/recurring-schedules', token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceExpenseId: created.id,
              intervalCount: Number(recurrenceInterval),
              intervalUnit: recurrenceUnit,
              firstDueDate: recurrenceStartDate || formData.invoice_date || new Date().toISOString().slice(0, 10),
            }),
          });
          if (!scheduleRes.ok) {
            toast({ variant: 'destructive', title: lang === 'de' ? 'Ausgabe gespeichert, Erinnerung konnte nicht angelegt werden' : 'Expense saved, but the reminder could not be created' });
          } else {
            qc.invalidateQueries({ queryKey: ['recurring-expense-schedules'] });
          }
        }
        toast({ title: lang === 'de' ? 'Ausgabe gespeichert' : 'Expense saved' });
      }

      qc.invalidateQueries({ queryKey: EXPENSES_KEY });
      setModalMode('none');
      setPendingFilePath(null);
      setFormData(BLANK_FORM);
      setFormItems([]);
      setEditingId(null);
      setExtractWarning('');
      setDuplicateWarning(null);
      setDuplicateExpense(null);
      setRecurrenceInterval('');
      setRecurrenceStartDate('');
    } catch {
      setSaveError(lang === 'de' ? 'Fehler beim Speichern. Bitte erneut versuchen.' : 'Save failed. Please try again.');
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Speichern' : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  // ── Modal cancel with orphan cleanup ──────────────────────────────────────────
  const cancelModal = useCallback(() => {
    if (saving) return;
    const pathToDelete = pendingFilePath;
    const isNewUpload  = editingId === null;
    setModalMode('none');
    setPendingFilePath(null);
    setFormData(BLANK_FORM);
    setFormItems([]);
    setEditingId(null);
    setExtractWarning('');
    setSaveError('');
    setDuplicateWarning(null);
    setDuplicateExpense(null);
    setRecurrenceInterval('');
    setRecurrenceStartDate('');

    if (pathToDelete && isNewUpload && token) {
      adminRequest('/api/admin/expenses/file', token, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileObjectPath: pathToDelete }),
      }).catch(() => { /* silent */ });
    }
  }, [saving, pendingFilePath, editingId, token]);

  const openEdit = async (e: Expense) => {
    setFormData(expenseToForm(e));
    setPendingFilePath(e.file_object_path);
    setEditingId(e.id);
    setExtractWarning('');
    setDuplicateWarning(null);
    setDuplicateExpense(null);
    setFormItems([]);
    setModalMode('edit');

    // Load existing items
    if (token) {
      setLoadingItems(true);
      try {
        const res = await adminRequest(`/api/admin/expenses/${e.id}/items`, token);
        if (res.ok) {
          const saved = await res.json() as SavedItem[];
          setFormItems(saved.map(savedItemToForm));
        }
      } catch { /* ignore */ } finally {
        setLoadingItems(false);
      }
    }
  };

  const handleViewFile = async (expenseId: number) => {
    if (!token) return;
    try {
      const res = await adminRequest(`/api/admin/expenses/${expenseId}/file`, token);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const tab = window.open(blobUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      if (!tab) {
        toast({ variant: 'destructive', title: lang === 'de' ? 'Popup blockiert' : 'Popup blocked', description: lang === 'de' ? 'Bitte Popup-Blocker deaktivieren' : 'Please allow popups for this site' });
      }
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Datei konnte nicht geöffnet werden' : 'Could not open file' });
    }
  };

  const handleDelete = async (id: number) => {
    if (!token) return;
    if (!confirm(lang === 'de' ? 'Ausgabe löschen?' : 'Delete expense?')) return;
    try {
      await adminDelete(`/api/admin/expenses/${id}`, token);
      qc.invalidateQueries({ queryKey: EXPENSES_KEY });
      toast({ title: lang === 'de' ? 'Gelöscht' : 'Deleted' });
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' });
    }
  };

  const updateSchedule = async (schedule: RecurringSchedule, patch: Partial<Pick<RecurringSchedule, 'enabled' | 'next_due_date' | 'interval_count' | 'interval_unit'>>) => {
    if (!token) return;
    const res = await adminRequest(`/api/admin/expenses/recurring-schedules/${schedule.id}`, token, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled: patch.enabled, nextDueDate: patch.next_due_date, intervalCount: patch.interval_count, intervalUnit: patch.interval_unit }),
    });
    if (!res.ok) { toast({ variant: 'destructive', title: lang === 'de' ? 'Plan konnte nicht aktualisiert werden' : 'Could not update schedule' }); return; }
    qc.invalidateQueries({ queryKey: ['recurring-expense-schedules'] });
  };
  const deleteSchedule = async (id: number) => {
    if (!token || !confirm(lang === 'de' ? 'Wiederkehrende Erinnerung entfernen?' : 'Remove recurring reminder?')) return;
    await adminDelete(`/api/admin/expenses/recurring-schedules/${id}`, token);
    qc.invalidateQueries({ queryKey: ['recurring-expense-schedules'] });
  };
  const confirmSchedule = async (schedule: RecurringSchedule) => {
    if (!token) return;
    const res = await adminRequest(`/api/admin/expenses/recurring-schedules/${schedule.id}/confirm`, token, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { toast({ variant: 'destructive', title: lang === 'de' ? 'Erinnerung konnte nicht bestätigt werden' : 'Could not confirm reminder' }); return; }
    const result = await res.json() as { template: Partial<ExpenseFormData> };
    setFormData({ ...BLANK_FORM, ...result.template, invoice_date_original: '', invoice_number: '', conversion_status: result.template.currency === 'EUR' ? 'not_needed' : 'unavailable' });
    setFormItems([]); setPendingFilePath(null); setEditingId(null); setRecurrenceInterval(''); setRecurrenceStartDate(''); setModalMode('manual');
    qc.invalidateQueries({ queryKey: ['recurring-expense-schedules'] });
  };

  // ── DATEV konto-mapping configuration ────────────────────────────────────────

  const [datevModalOpen, setDatevModalOpen]             = useState(false);
  const [kontoMap, setKontoMap]                         = useState<Record<string, string>>(DEFAULT_KONTO_MAP);
  const [gegenKonto, setGegenKonto]                     = useState('1600');
  const [datevSettingsLoaded, setDatevSettingsLoaded]   = useState(false);
  const [savingDatevSettings, setSavingDatevSettings]   = useState(false);

  const ensureDatevSettings = async () => {
    if (datevSettingsLoaded || !token) return;
    try {
      const res = await adminRequest('/api/admin/expenses/datev-settings', token);
      if (res.ok) {
        const d = await res.json() as { kontoMap: Record<string, string>; gegenKonto: string };
        setKontoMap(d.kontoMap);
        setGegenKonto(d.gegenKonto);
      }
    } catch { /* keep defaults */ }
    setDatevSettingsLoaded(true);
  };

  const openDatevModal = async () => {
    await ensureDatevSettings();
    setDatevModalOpen(true);
  };

  const handleSaveDatevSettings = async () => {
    if (!token) return;
    setSavingDatevSettings(true);
    try {
      const res = await adminRequest('/api/admin/expenses/datev-settings', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kontoMap, gegenKonto }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: lang === 'de' ? 'Kontenrahmen gespeichert' : 'Account mapping saved' });
      setDatevModalOpen(false);
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Speichern' : 'Save failed' });
    } finally {
      setSavingDatevSettings(false);
    }
  };

  // ── DATEV CSV export ──────────────────────────────────────────────────────────

  const handleDatevExport = async () => {
    if (!token) return;
    if (expenses.length === 0) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Keine Ausgaben vorhanden' : 'No expenses to export' });
      return;
    }
    const qp = new URLSearchParams();
    if (filterFrom)   qp.set('from',     filterFrom);
    if (filterTo)     qp.set('to',       filterTo);
    if (filterCat)    qp.set('category', filterCat);
    if (filterVendor) qp.set('vendor',   filterVendor);
    try {
      const res = await adminRequest(`/api/admin/expenses/datev-export?${qp.toString()}`, token);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DATEV_Ausgaben_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: lang === 'de' ? `${expenses.length} Einträge als DATEV exportiert` : `Exported ${expenses.length} entries as DATEV` });
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'DATEV-Export fehlgeschlagen' : 'DATEV export failed' });
    }
  };

  // ── CSV export ─────────────────────────────────────────────────────────────────

  const handleCsvExport = () => {
    const headers = ['Date', 'Vendor', 'Category', 'Source Net', 'Source VAT', 'Source Gross', 'Source Currency', 'EUR Net', 'EUR VAT', 'EUR Gross', 'Rate', 'Rate Date', 'Invoice #', 'Source', 'Notes'];
    const rows = expenses.map(e => [
      e.invoice_date ?? '', e.vendor_name ?? '', e.category ?? '',
      e.net_amount ?? '', e.tax_amount ?? '', e.gross_amount ?? '', e.currency,
      e.net_amount_eur ?? '', e.tax_amount_eur ?? '', e.gross_amount_eur ?? '',
      e.exchange_rate ?? '', e.exchange_rate_date ?? '', e.invoice_number ?? '', e.source, e.notes ?? '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast({ title: lang === 'de' ? `${expenses.length} Einträge exportiert` : `Exported ${expenses.length} entries` });
  };

  const modalOpen = modalMode !== 'none';
  const modalTitle = modalMode === 'confirm'
    ? (lang === 'de' ? 'Extraktion überprüfen & speichern' : 'Review Extraction & Save')
    : modalMode === 'edit'
      ? (lang === 'de' ? 'Ausgabe bearbeiten' : 'Edit Expense')
      : (lang === 'de' ? 'Ausgabe manuell hinzufügen' : 'Add Expense Manually');

  const isExtractBusy = uploadState !== 'idle';

  const CAT_COLORS: Record<string, string> = {
    'Office Supplies': 'bg-blue-100 text-blue-700',
    'Software':        'bg-purple-100 text-purple-700',
    'Travel':          'bg-amber-100 text-amber-700',
    'Medical Equipment': 'bg-rose-100 text-rose-700',
    'Consulting':      'bg-indigo-100 text-indigo-700',
    'Utilities':       'bg-teal-100 text-teal-700',
    'Advertising':     'bg-orange-100 text-orange-700',
    'Other':           'bg-gray-100 text-gray-700',
  };
  const unitLabel = (unit: RecurringUnit) => ({ day: lang === 'de' ? 'Tag' : 'Day', week: lang === 'de' ? 'Woche' : 'Week', month: lang === 'de' ? 'Monat' : 'Month', quarter: lang === 'de' ? 'Quartal' : 'Quarter', year: lang === 'de' ? 'Jahr' : 'Year' })[unit];

  return (
    <div className="space-y-6">
      {/* ── Page header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg"><Receipt className="w-5 h-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'Ausgaben & Rechnungen' : 'Expenses & Invoices'}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'de' ? 'Belege hochladen, KI-Extraktion, Ausgaben verwalten' : 'Upload receipts, AI extraction, manage expenses'}
          </p>
        </div>
      </div>

      {/* ── Summary cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {lang === 'de' ? 'Gesamt Brutto' : 'Total Gross'}
            </span>
          </div>
          <p className="text-2xl font-bold">{fmtAmount(totalGross, displayCurrency)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{expenses.length} {lang === 'de' ? 'Einträge' : 'entries'}</p>
        </div>
        <div className="bg-card border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Euro className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {lang === 'de' ? 'Gesamt MwSt.' : 'Total VAT Paid'}
            </span>
          </div>
          <p className="text-2xl font-bold">{fmtAmount(totalVat, displayCurrency)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {lang === 'de' ? 'Vorsteuer' : 'Input tax'}
          </p>
        </div>
        <div className="bg-card border rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Hash className="w-4 h-4 text-purple-600" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {lang === 'de' ? 'Anzahl Ausgaben' : 'Count of Expenses'}
            </span>
          </div>
          <p className="text-2xl font-bold">{expenses.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {eurCount > 0 && eurCount !== expenses.length
              ? `${eurCount} EUR`
              : lang === 'de' ? 'Einsendungen gesamt' : 'total records'}
          </p>
        </div>
      </div>

      {/* ── Orphan sweep health panel ─────────────────────────────────────────── */}
      {sweepStats !== undefined && (
        <div className="bg-card border rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-semibold">
                {lang === 'de' ? 'Datei-Bereinigung (letzter Lauf)' : 'Orphan File Cleanup (last run)'}
              </span>
            </div>
            {/* Threshold config */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{lang === 'de' ? 'Schwelle:' : 'Alert threshold:'}</span>
              {editingThreshold ? (
                <>
                  <input
                    type="number"
                    min="0"
                    className="w-14 h-6 rounded border border-input bg-background px-1.5 text-xs text-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={thresholdInput}
                    onChange={e => setThresholdInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveThreshold(); if (e.key === 'Escape') setEditingThreshold(false); }}
                    autoFocus
                  />
                  <button
                    onClick={saveThreshold}
                    disabled={savingThreshold}
                    className="text-emerald-600 hover:text-emerald-700 font-semibold px-1 disabled:opacity-50"
                  >
                    {lang === 'de' ? 'OK' : 'Save'}
                  </button>
                  <button onClick={() => setEditingThreshold(false)} className="text-muted-foreground hover:text-foreground px-1">
                    <X className="w-3 h-3" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setThresholdInput(String(spikeThreshold)); setEditingThreshold(true); }}
                  className="font-semibold text-foreground hover:text-primary underline decoration-dashed underline-offset-2"
                  title={lang === 'de' ? 'Schwelle bearbeiten' : 'Edit threshold'}
                >
                  {spikeThreshold}
                </button>
              )}
            </div>
          </div>

          {/* ── Spike alert banner ───────────────────────────────────────────── */}
          {isSpike && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-800">
                  {lang === 'de'
                    ? `${sweepStats!.deleted} Dateien gelöscht — möglicher Upload-Fehler-Spike`
                    : `${sweepStats!.deleted} files deleted — possible upload failure spike`}
                </p>
                <p className="text-xs text-amber-700 mt-0.5 leading-snug">
                  {lang === 'de'
                    ? 'Verwaiste Dateien entstehen, wenn ein Upload gestartet, aber nie als Ausgabe gespeichert wurde. Ein ungewöhnlich hoher Wert kann auf fehlerhafte Uploads oder Netzwerkprobleme hinweisen.'
                    : 'Orphaned files occur when a file is uploaded but never saved to an expense record. An unusually high count may indicate failed uploads or network issues.'}
                  {' '}
                  <a
                    href="https://cloud.google.com/storage/docs/resumable-uploads"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-amber-900"
                  >
                    {lang === 'de' ? 'Mehr erfahren' : 'Learn more'}
                  </a>
                </p>
              </div>
            </div>
          )}

          {sweepStats === null ? (
            <p className="text-sm text-muted-foreground">
              {lang === 'de' ? 'Noch kein Bereinigungslauf aufgezeichnet.' : 'No sweep has run yet.'}
            </p>
          ) : (
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-muted-foreground text-xs uppercase tracking-wide font-semibold block mb-0.5">
                  {lang === 'de' ? 'Zuletzt' : 'Last run'}
                </span>
                <span className="font-medium">
                  {new Date(sweepStats.last_run).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs uppercase tracking-wide font-semibold block mb-0.5">
                  {lang === 'de' ? 'Gescannt' : 'Scanned'}
                </span>
                <span className="font-medium">{sweepStats.scanned}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs uppercase tracking-wide font-semibold block mb-0.5">
                  {lang === 'de' ? 'Gelöscht' : 'Deleted'}
                </span>
                <span className={`font-medium ${sweepStats.deleted > 0 ? 'text-amber-600' : ''}`}>
                  {sweepStats.deleted}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs uppercase tracking-wide font-semibold block mb-0.5">
                  {lang === 'de' ? 'Fehler' : 'Errors'}
                </span>
                <span className={`font-medium ${sweepStats.errors > 0 ? 'text-red-600' : ''}`}>
                  {sweepStats.errors}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Upload zone ───────────────────────────────────────────────────────── */}
      {(recurringSchedules.length > 0 || recurringSchedulesError) && (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" /><div><h2 className="font-semibold">{lang === 'de' ? 'Wiederkehrende Ausgaben' : 'Recurring expenses'}</h2><p className="text-xs text-muted-foreground">{lang === 'de' ? 'Erinnerungen erstellen keine Buchungen automatisch.' : 'Reminders never create accounting entries automatically.'}</p></div></div>
          {(recurringSchedulesError || retryingRecurringSchedules || recurringScheduleRetryFailed) && (
            <div role="alert" className="mb-3 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <div className="flex min-w-0 items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  <p className="text-sm font-medium text-amber-900">
                    {lang === 'de' ? 'Wiederkehrende Erinnerungen sind vorübergehend nicht verfügbar.' : 'Recurring reminders are temporarily unavailable.'}
                  </p>
                  <p className="mt-0.5 text-xs text-amber-800">
                    {lang === 'de' ? 'Die Ausgaben können weiterhin bearbeitet werden.' : 'You can continue viewing and editing expenses.'}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={recurringSchedulesFetching || retryingRecurringSchedules}
                onClick={() => void retryRecurringSchedules()}
              >
                {(recurringSchedulesFetching || retryingRecurringSchedules) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {(recurringSchedulesFetching || retryingRecurringSchedules)
                  ? (lang === 'de' ? 'Wird geladen…' : 'Loading…')
                  : (lang === 'de' ? 'Erneut versuchen' : 'Try again')}
              </Button>
            </div>
          )}
          {recurringSchedules.length > 0 && (
            <div className="space-y-2">
              {recurringSchedules.map(schedule => {
                const overdue = schedule.enabled && schedule.next_due_date.slice(0, 10) <= new Date().toISOString().slice(0, 10);
                return <div key={schedule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                  <div><p className="text-sm font-medium">{schedule.template.vendor_name || (lang === 'de' ? 'Ohne Anbieter' : 'No vendor')}</p><div className="mt-1 flex flex-wrap items-center gap-2"><input aria-label={lang === 'de' ? 'Intervallzahl bearbeiten' : 'Edit interval number'} className="h-7 w-16 rounded border bg-background px-2 text-xs" type="number" min="1" max="999" value={schedule.interval_count} onChange={e => updateSchedule(schedule, { interval_count: Number(e.target.value) })} /><select aria-label={lang === 'de' ? 'Zeiteinheit bearbeiten' : 'Edit time unit'} className="h-7 rounded border bg-background px-2 text-xs" value={schedule.interval_unit} onChange={e => updateSchedule(schedule, { interval_unit: e.target.value as RecurringUnit })}>{RECURRING_UNITS.map(unit => <option key={unit} value={unit}>{unitLabel(unit)}</option>)}</select><span className="text-xs text-muted-foreground">{lang === 'de' ? 'Fällig:' : 'Due:'}</span><input aria-label={lang === 'de' ? 'Nächstes Fälligkeitsdatum' : 'Next due date'} className="h-7 rounded border bg-background px-2 text-xs" type="date" value={schedule.next_due_date.slice(0, 10)} onChange={e => updateSchedule(schedule, { next_due_date: e.target.value })} />{!schedule.enabled && <span className="text-xs text-muted-foreground">{lang === 'de' ? 'Pausiert' : 'Paused'}</span>}</div></div>
                  <div className="flex gap-1">
                    {schedule.enabled && <Button size="sm" onClick={() => confirmSchedule(schedule)} variant={overdue ? 'default' : 'outline'}>{lang === 'de' ? 'Manuellen Eintrag öffnen' : 'Open manual entry'}</Button>}
                    <Button size="sm" variant="ghost" title={schedule.enabled ? (lang === 'de' ? 'Pausieren' : 'Pause') : (lang === 'de' ? 'Fortsetzen' : 'Resume')} onClick={() => updateSchedule(schedule, { enabled: !schedule.enabled })}>{schedule.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteSchedule(schedule.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>;
              })}
            </div>
          )}
        </div>
      )}

      <div
        className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 bg-muted/20 hover:border-primary/50'
        } ${isExtractBusy ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !isExtractBusy && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={handleFileInput}
        />
        {isExtractBusy ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="font-medium text-sm">
              {uploadState === 'uploading'
                ? (lang === 'de' ? 'Datei wird hochgeladen…' : 'Uploading file…')
                : (lang === 'de' ? 'KI-Extraktion läuft…' : 'AI extraction in progress…')}
            </p>
            <p className="text-xs text-muted-foreground">{lang === 'de' ? 'Bitte warten' : 'Please wait'}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-3">
              <FileText className="w-8 h-8 text-muted-foreground/50" />
              <Upload className="w-8 h-8 text-muted-foreground/70" />
              <ImageIcon className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <div>
              <p className="font-medium text-sm">
                {lang === 'de' ? 'Datei hier ablegen oder klicken zum Auswählen' : 'Drop file here or click to select'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">PDF, PNG, JPEG · max. 20 MB</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
                {lang === 'de' ? '✦ KI-gestützte Extraktion inkl. Positionen' : '✦ AI extraction incl. line items'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">{lang === 'de' ? 'Von' : 'From'}</label>
          <Input type="date" className="h-8 text-sm w-36" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">{lang === 'de' ? 'Bis' : 'To'}</label>
          <Input type="date" className="h-8 text-sm w-36" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">{lang === 'de' ? 'Kategorie' : 'Category'}</label>
          <select
            className="flex h-8 rounded-md border border-input bg-background px-3 text-sm"
            value={filterCat}
            onChange={e => setFilterCat(e.target.value)}
          >
            <option value="">{lang === 'de' ? 'Alle' : 'All'}</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">{lang === 'de' ? 'Anbieter' : 'Vendor'}</label>
          <Input className="h-8 text-sm w-44" placeholder={lang === 'de' ? 'Suchen…' : 'Search…'} value={filterVendor} onChange={e => setFilterVendor(e.target.value)} />
        </div>
        {(filterFrom || filterTo || filterCat || filterVendor) && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterCat(''); setFilterVendor(''); }}>
            <X className="w-3.5 h-3.5 mr-1" />{lang === 'de' ? 'Filter zurücksetzen' : 'Clear filters'}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCsvExport} disabled={expenses.length === 0} className="gap-1.5 h-8">
            <Download className="w-4 h-4" />CSV
          </Button>
          <div className="flex items-center gap-0.5">
            <Button
              variant="outline" size="sm"
              onClick={handleDatevExport}
              disabled={expenses.length === 0}
              className="gap-1.5 h-8 rounded-r-none border-r-0"
              title={lang === 'de' ? 'DATEV Buchungsstapel-CSV herunterladen' : 'Download DATEV Buchungsstapel CSV'}
            >
              <FileArchive className="w-4 h-4" />DATEV
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={openDatevModal}
              className="h-8 px-2 rounded-l-none"
              title={lang === 'de' ? 'Kontenrahmen konfigurieren' : 'Configure account mapping'}
            >
              <Settings2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          <Button size="sm" className="gap-1.5 h-8" onClick={() => { setFormData(BLANK_FORM); setFormItems([]); setPendingFilePath(null); setEditingId(null); setExtractWarning(''); setRecurrenceInterval(''); setRecurrenceStartDate(''); setModalMode('manual'); }}>
            <Plus className="w-4 h-4" />
            {lang === 'de' ? 'Manuell hinzufügen' : 'Manual Entry'}
          </Button>
        </div>
      </div>

      {/* ── Expenses table ────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : expenses.length === 0 ? (
        <div className="text-center py-16 border rounded-xl bg-muted/10">
          <Receipt className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="font-medium text-muted-foreground text-sm">
            {lang === 'de' ? 'Keine Ausgaben vorhanden.' : 'No expenses yet.'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {lang === 'de' ? 'Laden Sie eine Datei hoch oder fügen Sie eine Ausgabe manuell hinzu.' : 'Upload a file or add an expense manually.'}
          </p>
        </div>
      ) : (
        <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  {[
                    lang === 'de' ? 'Datum' : 'Date',
                    lang === 'de' ? 'Anbieter' : 'Vendor',
                    lang === 'de' ? 'Kategorie' : 'Category',
                    lang === 'de' ? 'Netto' : 'Net',
                    lang === 'de' ? 'MwSt.' : 'VAT',
                    lang === 'de' ? 'Brutto' : 'Gross',
                    lang === 'de' ? 'Versand' : 'Shipping',
                    lang === 'de' ? 'Währung' : 'Currency',
                    lang === 'de' ? 'Rechnungs-Nr.' : 'Invoice #',
                    '',
                  ].map((h, i) => (
                    <th key={i} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {expenses.map(e => (
                  <tr key={e.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-sm">{fmtDate(e.invoice_date)}</td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <p className="font-medium truncate">{e.vendor_name || <span className="text-muted-foreground italic">—</span>}</p>
                    </td>
                    <td className="px-4 py-3">
                      {e.category
                        ? <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CAT_COLORS[e.category] ?? 'bg-gray-100 text-gray-700'}`}>{e.category}</span>
                        : <span className="text-muted-foreground">–</span>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div>{fmtAmount(e.net_amount, e.currency)}</div>
                      {e.net_amount_eur && e.currency !== 'EUR' && <div className="text-xs text-muted-foreground">≈ {fmtAmount(e.net_amount_eur)}</div>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div>{fmtAmount(e.tax_amount, e.currency)}</div>
                      {e.tax_amount_eur && e.currency !== 'EUR' && <div className="text-xs text-muted-foreground">≈ {fmtAmount(e.tax_amount_eur)}</div>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold">
                      <div>{fmtAmount(e.gross_amount, e.currency)}</div>
                      {e.gross_amount_eur && e.currency !== 'EUR' && <div className="text-xs font-normal text-muted-foreground">≈ {fmtAmount(e.gross_amount_eur)}</div>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-muted-foreground">
                      {e.shipping_cost ? fmtAmount(e.shipping_cost, e.currency) : '–'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted font-mono">{e.currency}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{e.invoice_number || '–'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {e.file_object_path && (
                          <Button
                            variant="ghost" size="sm"
                            title={lang === 'de' ? 'Quelldokument öffnen' : 'Open source document'}
                            onClick={() => handleViewFile(e.id)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => openEdit(e)}
                          className="text-muted-foreground hover:text-foreground"
                          title={lang === 'de' ? 'Bearbeiten' : 'Edit'}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => handleDelete(e.id)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          title={lang === 'de' ? 'Löschen' : 'Delete'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── DATEV konto-mapping modal ─────────────────────────────────────────── */}
      {datevModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget && !savingDatevSettings) setDatevModalOpen(false); }}
        >
          <div className="bg-card border rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div className="flex items-center gap-2">
                <FileArchive className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-base">
                  {lang === 'de' ? 'DATEV-Kontenrahmen konfigurieren' : 'Configure DATEV Account Mapping'}
                </h2>
              </div>
              <button onClick={() => { if (!savingDatevSettings) setDatevModalOpen(false); }} className="text-muted-foreground hover:text-foreground p-1 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <p className="text-xs text-muted-foreground">
                {lang === 'de'
                  ? 'Weisen Sie jeder Kategorie ein DATEV-Aufwandskonto (SKR04) zu.'
                  : 'Assign a DATEV expense account (SKR04) to each category.'}
              </p>
              <div className="space-y-2">
                {CATEGORIES.map(cat => (
                  <div key={cat} className="flex items-center gap-3">
                    <span className="text-sm w-40 shrink-0">{cat}</span>
                    <span className="text-muted-foreground text-xs shrink-0">→</span>
                    <input
                      className="flex h-8 w-24 rounded-md border border-input bg-background px-3 py-1 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={kontoMap[cat] ?? ''}
                      maxLength={8}
                      placeholder="6300"
                      onChange={e => setKontoMap(prev => ({ ...prev, [cat]: e.target.value.replace(/\D/g, '') }))}
                    />
                    <span className="text-xs text-muted-foreground">{lang === 'de' ? 'Konto' : 'Account'}</span>
                  </div>
                ))}
              </div>
              <div className="border-t pt-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm w-40 shrink-0 font-semibold">{lang === 'de' ? 'Gegenkonto' : 'Contra account'}</span>
                  <span className="text-muted-foreground text-xs shrink-0">→</span>
                  <input
                    className="flex h-8 w-24 rounded-md border border-input bg-background px-3 py-1 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={gegenKonto}
                    maxLength={8}
                    placeholder="1600"
                    onChange={e => setGegenKonto(e.target.value.replace(/\D/g, ''))}
                  />
                  <span className="text-xs text-muted-foreground">{lang === 'de' ? '(z.B. 1600 Verbindlichkeiten)' : '(e.g. 1600 Payables)'}</span>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDatevModalOpen(false)} disabled={savingDatevSettings}>
                {lang === 'de' ? 'Abbrechen' : 'Cancel'}
              </Button>
              <Button onClick={handleSaveDatevSettings} disabled={savingDatevSettings} className="gap-1.5">
                {savingDatevSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings2 className="w-4 h-4" />}
                {lang === 'de' ? 'Speichern' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm / Manual / Edit modal ─────────────────────────────────────── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) cancelModal(); }}
        >
          <div className="bg-card border rounded-2xl shadow-xl w-full max-w-2xl mx-4 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-base">{modalTitle}</h2>
              </div>
              <button onClick={() => cancelModal()} className="text-muted-foreground hover:text-foreground p-1 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {/* Possible duplicate warning */}
              {duplicateWarning && (
                <div className="flex items-start gap-3 rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-orange-500" />
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold">{lang === 'de' ? 'Mögliches Duplikat erkannt' : 'Possible duplicate detected'}</span>
                    <span>{duplicateWarning}</span>
                    {duplicateExpense && (
                      <div className="mt-2 rounded-md border border-orange-200 bg-white/60 px-3 py-2 text-xs text-orange-950">
                        <p className="mb-1.5 font-semibold">
                          {lang === 'de' ? 'Übereinstimmende Ausgabe' : 'Matching expense'}
                        </p>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                          {duplicateExpense.vendor_name && (
                            <>
                              <dt className="font-medium">{lang === 'de' ? 'Anbieter' : 'Vendor'}</dt>
                              <dd>{duplicateExpense.vendor_name}</dd>
                            </>
                          )}
                          {duplicateExpense.invoice_date && (
                            <>
                              <dt className="font-medium">{lang === 'de' ? 'Datum' : 'Date'}</dt>
                              <dd>{fmtDate(duplicateExpense.invoice_date)}</dd>
                            </>
                          )}
                          {duplicateExpense.invoice_number && (
                            <>
                              <dt className="font-medium">{lang === 'de' ? 'Rechnungsnummer' : 'Invoice number'}</dt>
                              <dd>{duplicateExpense.invoice_number}</dd>
                            </>
                          )}
                          {fmtDuplicateAmount(duplicateExpense.gross_amount, duplicateExpense.currency) && (
                            <>
                              <dt className="font-medium">{lang === 'de' ? 'Betrag' : 'Amount'}</dt>
                              <dd>{fmtDuplicateAmount(duplicateExpense.gross_amount, duplicateExpense.currency)}</dd>
                            </>
                          )}
                        </dl>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Amount consistency warning */}
              {amountMismatchWarning && (
                <div className="flex items-start gap-3 rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-orange-500" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold">{lang === 'de' ? 'Beträge stimmen nicht überein' : 'Amounts do not add up'}</span>
                    <span>{amountMismatchWarning}</span>
                  </div>
                </div>
              )}

              {/* AI confidence warning */}
              {extractWarning && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
                  <span>{extractWarning}</span>
                </div>
              )}

              {/* File indicator */}
              {pendingFilePath && modalMode !== 'edit' && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
                  <FileText className="w-3.5 h-3.5" />
                  <span>{lang === 'de' ? 'Quelldatei gespeichert' : 'Source file stored'}</span>
                  <span className="font-mono ml-auto truncate max-w-[200px]">{pendingFilePath.split('/').pop()}</span>
                </div>
              )}

              <ExpenseFormFields lang={lang} data={formData} onChange={setFormData} onRefreshConversion={refreshConversion} converting={converting} />
              {modalMode === 'manual' && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" /><p className="text-sm font-semibold">{lang === 'de' ? 'Wiederkehrende Ausgabe' : 'Recurring expense'}</p></div>
                  <p className="mt-1 text-xs text-muted-foreground">{lang === 'de' ? 'Erstellt nur eine Erinnerung. Jeder zukünftige Eintrag wird von Ihnen geprüft und gespeichert.' : 'Creates a reminder only. You will review and save every future entry.'}</p>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div><Label className="text-xs">{lang === 'de' ? 'Alle' : 'Every'}</Label><input className={inputCls} type="number" min="1" max="999" value={recurrenceInterval} placeholder="1" onChange={e => setRecurrenceInterval(e.target.value)} /></div>
                    <div><Label className="text-xs">{lang === 'de' ? 'Zeiteinheit' : 'Time unit'}</Label><select className={inputCls} value={recurrenceUnit} onChange={e => setRecurrenceUnit(e.target.value as RecurringUnit)}>{RECURRING_UNITS.map(unit => <option key={unit} value={unit}>{unitLabel(unit)}</option>)}</select></div>
                    {recurrenceInterval && <div><Label className="text-xs">{lang === 'de' ? 'Erste Erinnerung' : 'First reminder'}</Label><input className={inputCls} type="date" value={recurrenceStartDate || formData.invoice_date} onChange={e => setRecurrenceStartDate(e.target.value)} /></div>}
                  </div>
                </div>
              )}

              {/* Line items section */}
              {loadingItems ? (
                <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {lang === 'de' ? 'Positionen werden geladen…' : 'Loading items…'}
                </div>
              ) : (
                <LineItemsSection lang={lang} items={formItems} onChange={setFormItems} />
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t space-y-3 shrink-0">
              {saveError && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => cancelModal()} disabled={saving}>
                  {lang === 'de' ? 'Abbrechen' : 'Cancel'}
                </Button>
                {duplicateWarning ? (
                  <Button onClick={() => handleSave(true)} disabled={saving} variant="destructive" className="gap-1.5">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                    {lang === 'de' ? 'Trotzdem speichern' : 'Save anyway'}
                  </Button>
                ) : (
                  <Button onClick={() => handleSave()} disabled={saving} className="gap-1.5">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                    {modalMode === 'edit'
                      ? (lang === 'de' ? 'Speichern' : 'Save')
                      : (lang === 'de' ? 'Ausgabe speichern' : 'Save Expense')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
