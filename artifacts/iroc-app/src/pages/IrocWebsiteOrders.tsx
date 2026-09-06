import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { ShoppingCart, Loader2, FilePlus2, ExternalLink, Bot, RefreshCw, Truck, Trash2 } from 'lucide-react';
import { adminGet, adminPut, adminPost, adminDelete } from '@/lib/admin-fetch';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

interface IncomingOrder {
  id: number;
  websiteCustomerId: number | null;
  customerType: string;
  customerNr: string | null;
  companyName: string | null;
  contactName: string | null;
  contactEmail: string;
  contactPhone: string | null;
  instrument: string;
  products: string | null;
  deliveryAddress: string | null;
  notes: string | null;
  status: string; // pending | approved | cancelled
  approvedAt: string | null;
  createdAt: string;
  contactLanguage: string | null;
  sallyReviewStatus: string | null; // null | reviewing | missing_info | complete
  sallyReviewResult: string | null; // JSON { missing: string[] }
  invoice: { id: number; invoiceNumber: string; status: string } | null;
}
type Rate = { id: string; carrier: string; serviceCode: string; name: string; price: number; insurancePrice?: number; totalPrice?: number; currency: string; pickupSupported: boolean };
type ShippingRatesResponse = { rates: Rate[]; pickupWindow?: string; insuredValue?: number; uninsuredValue?: number; insuranceIncluded?: boolean };
type OrderFilter = 'all' | 'approved' | 'pending';

function filterFromSearch(search: string): OrderFilter {
  const value = new URLSearchParams(search).get('status');
  return value === 'all' || value === 'approved' || value === 'pending' ? value : 'approved';
}

const sallyBadge = (status: string | null, lang: string) => {
  if (!status) return null;
  const map: Record<string, [string, string, string]> = {
    reviewing:    ['bg-sky-100 text-sky-700',     'Sally prüft…',            'Sally reviewing…'],
    missing_info: ['bg-rose-100 text-rose-700',   'Info angefordert',        'Info requested'],
    complete:     ['bg-emerald-100 text-emerald-700', 'Sally: vollständig',  'Sally: complete'],
  };
  const entry = map[status];
  if (!entry) return null;
  const [cls, de, en] = entry;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded ${cls}`}>
      <Bot className="w-3 h-3" />
      {lang === 'de' ? de : en}
    </span>
  );
};

function missingItems(result: string | null): string[] {
  if (!result) return [];
  try {
    const parsed = JSON.parse(result) as { missing?: string[] };
    return parsed.missing ?? [];
  } catch { return []; }
}

const statusBadge = (status: string, lang: string) => {
  const map: Record<string, [string, string, string]> = {
    pending:   ['bg-amber-100 text-amber-700',  'Warten auf Bestätigung', 'Awaiting confirmation'],
    approved:  ['bg-green-100 text-green-700',  'Bestätigt',              'Confirmed'],
    cancelled: ['bg-gray-100 text-gray-500',    'Storniert',              'Cancelled'],
  };
  const [cls, de, en] = map[status] ?? ['bg-gray-100 text-gray-500', status, status];
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded ${cls}`}>{lang === 'de' ? de : en}</span>;
};

export default function IrocWebsiteOrders() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const [location] = useLocation();
  const [orders, setOrders] = useState<IncomingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<OrderFilter>(() => filterFromSearch(window.location.search));
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [shippingOrderId, setShippingOrderId] = useState<number | null>(null);
  const [shipping, setShipping] = useState({ weightKg: '1', lengthCm: '', widthCm: '', heightCm: '', rate: null as Rate | null });
  const [includeInsurance, setIncludeInsurance] = useState(true);
  const [rates, setRates] = useState<Rate[]>([]);
  const [pickupWindow, setPickupWindow] = useState('');
  const [shippingBusy, setShippingBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    setFilter(filterFromSearch(window.location.search));
  }, [location]);

  useEffect(() => {
    if (!token) return;
    adminGet<IncomingOrder[]>('/api/iroc/orders', token)
      .then(setOrders)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSetLanguage(orderId: number, language: string) {
    if (!token) return;
    const previous = orders;
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, contactLanguage: language } : o));
    try {
      await adminPut(`/api/admin/sally/orders/${orderId}/language`, token, { language });
    } catch {
      setOrders(previous);
      toast({ title: lang === 'de' ? 'Fehler beim Speichern' : 'Save failed', variant: 'destructive' });
    }
  }

  async function handleRerunReview(orderId: number) {
    if (!token) return;
    setReviewingId(orderId);
    try {
      const res = await adminPost<{ ok: boolean; status: string }>(`/api/admin/sally/orders/${orderId}/review`, token, {});
      const fresh = await adminGet<IncomingOrder[]>('/api/iroc/orders', token);
      setOrders(fresh);
      toast({
        title: res.status === 'complete'
          ? (lang === 'de' ? 'Sally: Bestellung vollständig' : 'Sally: order complete')
          : res.status === 'missing_info'
            ? (lang === 'de' ? 'Sally hat eine Rückfrage-E-Mail entworfen' : 'Sally drafted a missing-info email')
            : (lang === 'de' ? 'Prüfung läuft' : 'Review running'),
      });
    } catch (err) {
      toast({ title: String(err), variant: 'destructive' });
    } finally {
      setReviewingId(null);
    }
  }

  async function handleDelete(order: IncomingOrder) {
    if (!token) return;
    const orderLabel = order.companyName || order.contactName || order.contactEmail;
    const confirmed = window.confirm(
      lang === 'de'
        ? `Bestellung #${order.id} von ${orderLabel} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`
        : `Delete order #${order.id} from ${orderLabel}? This action cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingId(order.id);
    try {
      await adminDelete(`/api/iroc/orders/${order.id}`, token);
      setOrders(previous => previous.filter(item => item.id !== order.id));
      if (shippingOrderId === order.id) {
        setShippingOrderId(null);
        setRates([]);
      }
      toast({ title: lang === 'de' ? 'Bestellung gelöscht' : 'Order deleted' });
    } catch (error) {
      toast({
        title: error instanceof Error && error.message === 'ORDER_HAS_SHIPMENT'
          ? (lang === 'de'
            ? 'Bestellung mit bestehender Sendung kann nicht gelöscht werden.'
            : 'An order with an existing shipment cannot be deleted.')
          : String(error),
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  }

  async function loadRates(orderId: number) {
    if (!token) return;
    const weight = Number(shipping.weightKg);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast({ title: lang === 'de' ? 'Bitte ein gültiges Gewicht eintragen.' : 'Enter a valid parcel weight.', variant: 'destructive' }); return;
    }
    setShippingBusy(true);
    try {
      const response = await adminGet<ShippingRatesResponse>(`/api/iroc/orders/${orderId}/shipping-rates?weightKg=${weight}&includeInsurance=${includeInsurance}`, token);
      setRates(response.rates);
      setPickupWindow(response.pickupWindow ?? '');
      setShipping(current => ({ ...current, rate: response.rates[0] ?? null }));
      if (!response.rates.length) toast({ title: lang === 'de' ? 'Keine Sendcloud-Tarife verfügbar.' : 'No Sendcloud rates are available.', variant: 'destructive' });
    } catch (error) {
      toast({ title: String(error), variant: 'destructive' });
    } finally { setShippingBusy(false); }
  }

  async function createShipment(order: IncomingOrder) {
    if (!token || !shipping.rate) return;
    if (!order.invoice || order.invoice.status !== 'draft') {
      toast({ title: lang === 'de' ? 'Die Lieferung kann nur zu einer Entwurfsrechnung hinzugefügt werden.' : 'A shipment can only be added to a draft invoice.', variant: 'destructive' }); return;
    }
    setShippingBusy(true);
    try {
      const result = await adminPost<{ trackingNumber: string | null }>(`/api/iroc/orders/${order.id}/shipment`, token, {
        serviceId: shipping.rate.id, carrier: shipping.rate.carrier, serviceCode: shipping.rate.serviceCode,
        quotedDeliveryCost: shipping.rate.price, quotedInsuranceCost: includeInsurance ? (shipping.rate.insurancePrice ?? 0) : 0,
        includeInsurance, weightKg: Number(shipping.weightKg),
        lengthCm: shipping.lengthCm ? Number(shipping.lengthCm) : undefined,
        widthCm: shipping.widthCm ? Number(shipping.widthCm) : undefined,
        heightCm: shipping.heightCm ? Number(shipping.heightCm) : undefined, confirm: true,
      });
      toast({ title: result.trackingNumber ? `${lang === 'de' ? 'Sendung erstellt:' : 'Shipment created:'} ${result.trackingNumber}` : (lang === 'de' ? 'Sendung erstellt.' : 'Shipment created.') });
      setShippingOrderId(null); setRates([]);
    } catch (error) {
      toast({ title: String(error), variant: 'destructive' });
    } finally { setShippingBusy(false); }
  }

  const shown = orders.filter(o => filter === 'all' || o.status === filter);
  const counts = {
    approved: orders.filter(o => o.status === 'approved').length,
    pending: orders.filter(o => o.status === 'pending').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <ShoppingCart className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'Eingehende Bestellungen' : 'Incoming Orders'}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'de'
              ? 'Bestellungen über das Website-Formular. Sichtbar zur Bearbeitung erst nach Kundenbestätigung per E-Mail-Link.'
              : 'Orders via the website form. Ready for processing only after the customer confirms via email link.'}
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {([
          ['approved', lang === 'de' ? `Bestätigt (${counts.approved})` : `Confirmed (${counts.approved})`],
          ['pending',  lang === 'de' ? `Ausstehend (${counts.pending})` : `Pending (${counts.pending})`],
          ['all',      lang === 'de' ? 'Alle' : 'All'],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
              filter === key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
          {shown.length === 0 ? (
            <p className="text-center py-16 text-muted-foreground text-sm">
              {lang === 'de' ? 'Keine Bestellungen gefunden.' : 'No orders found.'}
            </p>
          ) : (
            <div className="divide-y">
              {shown.map(o => (
                <div key={o.id} className="px-5 py-4 space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    {statusBadge(o.status, lang)}
                    {o.status === 'approved' && sallyBadge(o.sallyReviewStatus, lang)}
                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${o.customerType === 'existing' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                      {o.customerType === 'existing' ? (lang === 'de' ? 'Bestandskunde' : 'Existing') : (lang === 'de' ? 'Neukunde' : 'New')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {o.companyName || o.contactName || o.contactEmail}
                        {o.customerNr && <span className="ml-2 text-xs text-muted-foreground font-mono">#{o.customerNr}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[o.contactEmail, o.instrument].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(o.createdAt).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB')}
                    </span>
                    {o.status === 'approved' && (
                      <div className="flex gap-1.5 shrink-0">
                        {o.invoice ? (
                          <Link href={`/invoices/${o.invoice.id}`}>
                            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
                              <ExternalLink className="w-3.5 h-3.5" />
                              {lang === 'de' ? `Rechnung ${o.invoice.invoiceNumber}` : `Invoice ${o.invoice.invoiceNumber}`}
                            </Button>
                          </Link>
                        ) : (
                        <Link href={o.websiteCustomerId ? `/invoices/new?websiteCustomerId=${o.websiteCustomerId}` : '/invoices/new'}>
                          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
                            <FilePlus2 className="w-3.5 h-3.5" />
                            {lang === 'de' ? 'Rechnung erstellen' : 'Create Invoice'}
                          </Button>
                        </Link>
                        )}
                        {o.websiteCustomerId && (
                          <Link href={`/iroc-website/customers?highlight=${o.websiteCustomerId}`}>
                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground">
                              <ExternalLink className="w-3.5 h-3.5" />
                              {lang === 'de' ? 'Kunde' : 'Customer'}
                            </Button>
                          </Link>
                        )}
                        {o.invoice?.status === 'draft' && (
                          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                            onClick={() => { setShippingOrderId(shippingOrderId === o.id ? null : o.id); setRates([]); setPickupWindow(''); setShipping({ weightKg: '1', lengthCm: '', widthCm: '', heightCm: '', rate: null }); }}>
                            <Truck className="w-3.5 h-3.5" />
                            {lang === 'de' ? 'Versand' : 'Ship'}
                          </Button>
                        )}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                      disabled={deletingId === o.id}
                      onClick={() => handleDelete(o)}
                      title={lang === 'de' ? 'Bestellung löschen' : 'Delete order'}
                    >
                      {deletingId === o.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                      {lang === 'de' ? 'Löschen' : 'Delete'}
                    </Button>
                  </div>
                  {shippingOrderId === o.id && (
                    <div className="mt-3 rounded-lg border bg-muted/30 p-3 space-y-3">
                      <div className="flex flex-wrap gap-2 items-end">
                        {([
                          ['weightKg', lang === 'de' ? 'Gewicht (kg)' : 'Weight (kg)'],
                          ['lengthCm', lang === 'de' ? 'Länge (cm)' : 'Length (cm)'],
                          ['widthCm', lang === 'de' ? 'Breite (cm)' : 'Width (cm)'],
                          ['heightCm', lang === 'de' ? 'Höhe (cm)' : 'Height (cm)'],
                        ] as const).map(([key, label]) => (
                          <label key={key} className="text-xs text-muted-foreground">{label}
                            <input type="number" min="0" step="0.1" value={shipping[key]}
                              onChange={e => setShipping(s => ({ ...s, [key]: e.target.value }))} className="mt-1 block w-24 rounded border bg-background px-2 py-1 text-sm" />
                          </label>
                        ))}
                        <fieldset className="flex items-center gap-3 text-xs">
                          <legend className="sr-only">{lang === 'de' ? 'Versicherung' : 'Insurance'}</legend>
                          <label className="flex items-center gap-1.5">
                            <input type="radio" name={`order-insurance-${o.id}`} checked={includeInsurance} onChange={() => { setIncludeInsurance(true); setRates([]); setShipping(s => ({ ...s, rate: null })); }} />
                            {lang === 'de' ? 'Mit Versicherung' : 'Include insurance'}
                          </label>
                          <label className="flex items-center gap-1.5">
                            <input type="radio" name={`order-insurance-${o.id}`} checked={!includeInsurance} onChange={() => { setIncludeInsurance(false); setRates([]); setShipping(s => ({ ...s, rate: null })); }} />
                            {lang === 'de' ? 'Ohne Versicherung' : 'Exclude insurance'}
                          </label>
                        </fieldset>
                        <Button size="sm" onClick={() => loadRates(o.id)} disabled={shippingBusy}>
                          {shippingBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (lang === 'de' ? 'Tarife laden' : 'Load rates')}
                        </Button>
                      </div>
                      {rates.length > 0 && <div className="grid gap-1">
                        {rates.map(rate => <label key={rate.id} className="flex items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs">
                          <input type="radio" checked={shipping.rate?.id === rate.id} onChange={() => setShipping(s => ({ ...s, rate }))} />
                          <span className="flex-1 font-medium">{rate.carrier} · {rate.name}</span>
                          <span>{(rate.totalPrice ?? rate.price).toFixed(2)} {rate.currency}{includeInsurance && (rate.insurancePrice ?? 0) > 0 ? ` · ${lang === 'de' ? 'Vers.' : 'ins.'} ${(rate.insurancePrice ?? 0).toFixed(2)}` : ''}</span>
                          {rate.pickupSupported && <span className="text-emerald-700">
                            {lang === 'de'
                              ? `Abholung ${(pickupWindow || 'Mon/Wed/Fri 09:00–13:00 (when supported)').replace('Mon/Wed/Fri', 'Mo/Mi/Fr').replace(' (when supported)', '')}`
                              : `Pickup ${(pickupWindow || 'Mon/Wed/Fri 09:00–13:00 (when supported)').replace(' (when supported)', '')}`}
                          </span>}
                        </label>)}
                        <div className="pt-1 flex justify-end">
                          <Button size="sm" disabled={!shipping.rate || shippingBusy} onClick={() => createShipment(o)}>
                            {lang === 'de' ? 'Sendung verbindlich erstellen' : 'Create confirmed shipment'}
                          </Button>
                        </div>
                      </div>}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground space-y-0.5 pl-1">
                    {o.products && <p><span className="font-semibold">{lang === 'de' ? 'Produkte:' : 'Products:'}</span> {o.products}</p>}
                    {o.deliveryAddress && <p><span className="font-semibold">{lang === 'de' ? 'Lieferadresse:' : 'Delivery address:'}</span> {o.deliveryAddress}</p>}
                    {o.notes && <p><span className="font-semibold">{lang === 'de' ? 'Anmerkungen:' : 'Notes:'}</span> {o.notes}</p>}
                    {o.approvedAt && (
                      <p><span className="font-semibold">{lang === 'de' ? 'Bestätigt am:' : 'Confirmed at:'}</span> {new Date(o.approvedAt).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB')}</p>
                    )}
                    {o.status === 'approved' && o.sallyReviewStatus === 'missing_info' && missingItems(o.sallyReviewResult).length > 0 && (
                      <div className="mt-1 bg-rose-50 border border-rose-100 rounded-md px-2.5 py-1.5">
                        <p className="font-semibold text-rose-700 flex items-center gap-1">
                          <Bot className="w-3 h-3" />
                          {lang === 'de' ? 'Fehlende Angaben:' : 'Missing information:'}
                        </p>
                        <ul className="list-disc ml-4 text-rose-700/90">
                          {missingItems(o.sallyReviewResult).map((m, i) => <li key={i}>{m}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                  {o.status === 'approved' && (
                    <div className="flex items-center gap-3 pl-1 pt-1">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{lang === 'de' ? 'Kontaktsprache:' : 'Contact language:'}</span>
                        <select
                          value={o.contactLanguage ?? ''}
                          onChange={e => e.target.value && handleSetLanguage(o.id, e.target.value)}
                          className="border rounded px-1.5 py-0.5 text-xs bg-card"
                        >
                          <option value="" disabled>{lang === 'de' ? 'Unbekannt' : 'Unknown'}</option>
                          <option value="de">Deutsch</option>
                          <option value="en">English</option>
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRerunReview(o.id)}
                        disabled={reviewingId === o.id}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        {reviewingId === o.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <RefreshCw className="w-3 h-3" />}
                        {lang === 'de' ? 'Sally-Prüfung erneut ausführen' : 'Re-run Sally review'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
