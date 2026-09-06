import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { CountrySelect } from "@/components/CountrySelect";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";
import { adminGet, adminPost, adminDelete, adminPatch } from "@/lib/admin-fetch";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Building2, MapPin, ChevronUp, ChevronDown, Trash2, Pencil, Merge, X, Eye, Copy, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useListIrocInvoices } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";

const EU_COUNTRIES = new Set(["AT","BE","BG","CY","CZ","DK","EE","FI","FR","GR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","ES"]);

/** Map free-text country names (DE + EN variants, common typos) → ISO 2-letter code. */
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  GERMANY: "DE", DEUTSCHLAND: "DE",
  AUSTRIA: "AT", ÖSTERREICH: "AT", OSTERREICH: "AT", OESTERREICH: "AT", ÖSTEREICH: "AT",
  BELGIUM: "BE", BELGIEN: "BE",
  BULGARIA: "BG", BULGARIEN: "BG",
  CYPRUS: "CY", ZYPERN: "CY",
  "CZECH REPUBLIC": "CZ", CZECHIA: "CZ", TSCHECHIEN: "CZ",
  DENMARK: "DK", DÄNEMARK: "DK", DAENEMARK: "DK",
  ESTONIA: "EE", ESTLAND: "EE",
  FINLAND: "FI", FINNLAND: "FI",
  FRANCE: "FR", FRANKREICH: "FR",
  GREECE: "GR", GRIECHENLAND: "GR",
  CROATIA: "HR", KROATIEN: "HR",
  HUNGARY: "HU", UNGARN: "HU",
  IRELAND: "IE", IRLAND: "IE",
  ITALY: "IT", ITALIEN: "IT",
  LITHUANIA: "LT", LITAUEN: "LT",
  LUXEMBOURG: "LU", LUXEMBURG: "LU",
  LATVIA: "LV", LETTLAND: "LV",
  MALTA: "MT",
  NETHERLANDS: "NL", NIEDERLANDE: "NL", HOLLAND: "NL",
  POLAND: "PL", POLEN: "PL",
  PORTUGAL: "PT",
  ROMANIA: "RO", RUMÄNIEN: "RO", RUMAENIEN: "RO",
  SWEDEN: "SE", SCHWEDEN: "SE",
  SLOVENIA: "SI", SLOWENIEN: "SI",
  SLOVAKIA: "SK", SLOWAKEI: "SK", SLOVAKAI: "SK",
  SPAIN: "ES", SPANIEN: "ES",
  SWITZERLAND: "CH", SCHWEIZ: "CH", SUISSE: "CH",
  "UNITED KINGDOM": "GB", "GREAT BRITAIN": "GB", UK: "GB", GROSSBRITANNIEN: "GB", ENGLAND: "GB",
  "UNITED STATES": "US", USA: "US", "VEREINIGTE STAATEN": "US",
  NORWAY: "NO", NORWEGEN: "NO",
  TURKEY: "TR", TÜRKEI: "TR",
  GUERNSEY: "GG",
  LIECHTENSTEIN: "LI",
};

/** Normalise any stored country value to an uppercase ISO 2-letter code. */
function normalizeCountryToIso(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return COUNTRY_NAME_TO_ISO[trimmed.toUpperCase()] ?? trimmed.toUpperCase();
}

/** Format an ISO code for display, e.g. "DE" → "DE — Deutschland". */
const _dn_de = new Intl.DisplayNames(["de"], { type: "region" });
const _dn_en = new Intl.DisplayNames(["en"], { type: "region" });
function formatCountry(raw: string | null | undefined, lang: string): string {
  const iso = normalizeCountryToIso(raw);
  if (!iso || iso.length !== 2) return raw ?? "—";
  const dn = lang === "de" ? _dn_de : _dn_en;
  try {
    const name = dn.of(iso);
    return name ? `${iso} — ${name}` : iso;
  } catch { return iso; }
}

interface WebsiteCustomer {
  id: number;
  customerNr: string | null;
  salutation: string | null;
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  institutionName: string | null;
  institutionType: string | null;
  specialty: string | null;
  email: string;
  phone: string | null;
  fax: string | null;
  website: string | null;
  referenceNumber: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  ustIdNr: string | null;
  instrument: string;
  certifications?: string[];
  notes: string | null;
  shippingFirstName: string | null;
  shippingLastName: string | null;
  shippingInstitutionName: string | null;
  shippingAddress: string | null;
  shippingPostalCode: string | null;
  shippingCity: string | null;
  shippingCountry: string | null;
  shippingPhone: string | null;
  shippingEmail: string | null;
  createdAt: string;
}

interface LegacyCustomer {
  id: number;
  salutation: string | null;
  title: string | null;
  name: string;
  company: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  vatId: string | null;
  isEu: boolean;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
}

interface ProductGroup {
  id: number;
  key: string;
  nameDe: string;
  nameEn: string;
  sortOrder: number;
  isService: boolean;
}

/** Parse a comma-separated instrument string (or legacy single value) into a Set of group keys. */
function parseInstrument(instrument: string): Set<string> {
  if (!instrument) return new Set();
  // Legacy: "both" means spirecut + ministem
  if (instrument === "both") return new Set(["spirecut", "ministem"]);
  return new Set(instrument.split(",").map(s => s.trim()).filter(Boolean));
}

/** Serialize a Set of group keys back to a comma-separated string. */
function serializeInstrument(keys: Set<string>): string {
  return [...keys].sort().join(",");
}

function customerCertifications(customer: Pick<WebsiteCustomer, "certifications" | "instrument">): Set<string> {
  return customer.certifications && customer.certifications.length > 0
    ? new Set(customer.certifications)
    : parseInstrument(customer.instrument);
}

/** Fallback display labels for legacy values not in the DB. */
const LEGACY_LABELS: Record<string, string> = {
  other: "Other / Sonstige",
  post_training_support: "Post-Training Support",
  practice_marketing_support: "Practice Marketing Support",
};

const LEGACY_TITLE_PREFIX = /^(?:(?:prof(?:essor)?\.?\s+)?dr\.?(?:\s+med\.?)?|prof(?:essor)?\.?|dipl\.?-?ing\.?|mag\.?|ph\.?d\.?|m\.?d\.?)\s+/iu;

/** Keep old rows readable when their full name still contains the separate title. */
function normalizeLegacyCustomerName(nameValue: string, title: string | null | undefined): string {
  const originalName = nameValue.trim();
  let name = originalName;
  if (title?.trim()) {
    // A server-normalized row normally needs no work here, but this protects
    // the list while older cached/API rows are still being refreshed.
    for (let pass = 0; pass < 3; pass++) {
      const before = name;
      const titlePrefix = new RegExp(`^${title.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+|$)`, "iu");
      name = name.replace(titlePrefix, "").trim().replace(LEGACY_TITLE_PREFIX, "").trim();
      if (name === before) break;
    }
  }
  return name || originalName;
}

function legacyCustomerDisplayName(customer: Pick<LegacyCustomer, "salutation" | "title" | "name">): string {
  const name = normalizeLegacyCustomerName(customer.name, customer.title);
  return [customer.salutation, customer.title, name].filter(Boolean).join(" ");
}

type EditState = {
  id: number;
  customerNr: string;
  salutation: string;
  title: string;
  firstName: string;
  lastName: string;
  institutionName: string;
  specialty: string;
  email: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  ustIdNr: string;
  website: string;
  instrument: string;
  certifications: string[];
  notes: string;
  shippingFirstName: string;
  shippingLastName: string;
  shippingInstitutionName: string;
  shippingAddress: string;
  shippingPostalCode: string;
  shippingCity: string;
  shippingCountry: string;
  shippingPhone: string;
  shippingEmail: string;
};

type LegacyEditState = {
  id: number | null;
  salutation: string;
  title: string;
  name: string;
  company: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  vatId: string;
  isEu: boolean;
  email: string;
  phone: string;
  notes: string;
};

export default function CustomersList() {
  const { lang } = useLanguage();
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "customerNr">("customerNr");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // Invoice status filter (activated via ?invoiceStatus=pending from Dashboard)
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("invoiceStatus") === "pending";
  });
  const { data: allInvoices } = useListIrocInvoices();
  const pendingCustomerIds = useMemo<Set<number> | null>(() => {
    if (!invoiceStatusFilter || !allInvoices) return null;
    const ids = new Set<number>();
    for (const inv of allInvoices) {
      if ((inv.status === "draft" || inv.status === "sent") && inv.websiteCustomerId != null) {
        ids.add(inv.websiteCustomerId);
      }
    }
    return ids;
  }, [invoiceStatusFilter, allInvoices]);

  const customerQuery = useQuery({
    queryKey: ["iroc-customers-list", token],
    queryFn: async () => {
      if (!token) return { websiteRows: [] as WebsiteCustomer[], legacyRows: [] as LegacyCustomer[] };
      const [websiteRows, legacyRows] = await Promise.all([
        adminGet<WebsiteCustomer[]>("/api/iroc/website-customers", token),
        adminGet<LegacyCustomer[]>("/api/iroc/customers", token),
      ]);
      return { websiteRows, legacyRows };
    },
    enabled: !!token,
    refetchOnWindowFocus: true,
  });
  const [retrying, setRetrying] = useState(false);
  const retryObservedRef = useRef(false);
  useEffect(() => {
    if (retrying && customerQuery.fetchStatus === "fetching") {
      retryObservedRef.current = true;
    }
    if (
      retrying &&
      retryObservedRef.current &&
      customerQuery.fetchStatus === "idle" &&
      (customerQuery.isError || customerQuery.data)
    ) {
      retryObservedRef.current = false;
      setRetrying(false);
    }
  }, [customerQuery.data, customerQuery.fetchStatus, customerQuery.isError, retrying]);
  const handleRetry = () => {
    setRetrying(true);
    void customerQuery.refetch();
  };
  const retryInProgress = retrying || customerQuery.fetchStatus === "fetching";
  const customers = customerQuery.data?.websiteRows ?? [];
  const legacyCustomers = customerQuery.data?.legacyRows ?? [];
  const loading = customerQuery.isLoading;

  // Product groups (fetched from DB)
  const [productGroups, setProductGroups] = useState<ProductGroup[]>([]);
  useEffect(() => {
    if (!token) return;
    adminGet<ProductGroup[]>("/api/iroc/product-groups", token)
      .then(groups => setProductGroups(groups))
      .catch(() => {});
  }, [token]);

  // Merge state
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePrimaryId, setMergePrimaryId] = useState<number | null>(null);
  const [merging, setMerging] = useState(false);

  // ── Institution-name suggestion helpers ──────────────────────────────────────
  type InstSugg = { address: string; postalCode: string; city: string; countryCode: string; displayName: string };
  const lookupInstitutionMulti = useCallback(async (name: string, signal?: AbortSignal): Promise<InstSugg[]> => {
    if (!name || name.length < 3) return [];
    try {
      const res = await fetch(`/api/lookup-institution?name=${encodeURIComponent(name)}`, { signal });
      if (!res.ok) return [];
      const d = await res.json();
      return Array.isArray(d) ? d.filter((r: InstSugg) => r.city || r.postalCode) : [];
    } catch { return []; }
  }, []);

  // Suggestion state — new customer (institution)
  const [newInstSuggestions, setNewInstSuggestions] = useState<InstSugg[]>([]);
  // Suggestion state — edit customer (institution)
  const [editInstSuggestions, setEditInstSuggestions] = useState<InstSugg[]>([]);

  // ── VAT ID lookup helper ─────────────────────────────────────────────────────
  type VatStatus = "idle" | "loading" | "found" | "not-found";
  const lookupVat = useCallback(async (website: string, institutionName: string, country?: string, city?: string, signal?: AbortSignal): Promise<string | null> => {
    const params = new URLSearchParams();
    if (website)         params.set("website",         website);
    if (institutionName) params.set("institutionName", institutionName);
    if (country)         params.set("country",         country);
    if (city)            params.set("city",            city);
    if (!website && !institutionName) return null;
    try {
      const res = await fetch(`/api/lookup-vat?${params}`, { signal });
      if (!res.ok) return null;
      const d = await res.json() as { vatId: string | null };
      return d.vatId ?? null;
    } catch { return null; }
  }, []);

  // VAT lookup state — new customer form
  const [newVatStatus, setNewVatStatus] = useState<VatStatus>("idle");
  const [newVatSugg,   setNewVatSugg]   = useState<string | null>(null);
  const [newVatDism,   setNewVatDism]   = useState(false);
  // VAT lookup state — edit customer form
  const [editVatStatus, setEditVatStatus] = useState<VatStatus>("idle");
  const [editVatSugg,   setEditVatSugg]   = useState<string | null>(null);
  const [editVatDism,   setEditVatDism]   = useState(false);
  // Signal states: set by the suggestion handler to trigger an immediate
  // (zero-delay) VAT lookup. A dedicated effect consumes the signal.
  const [newVatSignal,  setNewVatSignal]  = useState<{ name: string; website: string; country: string; city: string } | null>(null);
  const [editVatSignal, setEditVatSignal] = useState<{ name: string; website: string; country: string; city: string } | null>(null);
  // Request-generation counters: every new lookup (or manual VAT edit) bumps the
  // counter; a response is only applied when its generation is still current.
  // Prevents a stale response from overwriting newer data or a manual edit.
  const newVatGenRef  = useRef(0);
  const editVatGenRef = useRef(0);
  const newVatAbortRef = useRef<AbortController | null>(null);
  const editVatAbortRef = useRef<AbortController | null>(null);
  const newInstGenRef = useRef(0);
  const editInstGenRef = useRef(0);
  const newBillGenRef = useRef(0);
  const newShipGenRef = useRef(0);
  const editBillGenRef = useRef(0);
  const editShipGenRef = useRef(0);
  // Suppress the debounced effect for the render cycle caused by a suggestion
  // pick (the signal effect handles that lookup; avoids duplicate API calls).
  const newVatSuppressRef  = useRef(false);
  const editVatSuppressRef = useRef(false);

  // ── Postal-code suggestion helpers ───────────────────────────────────────────
  type PostalSugg = { city: string; countryCode: string; postcode: string } | null;
  const lookupPostal = useCallback(async (postal: string, country: string, signal?: AbortSignal): Promise<PostalSugg> => {
    if (!postal || postal.length < 4) return null;
    const cc = country.length === 2 ? country : 'DE';
    try {
      const res = await fetch(`/api/lookup-postal?postalCode=${encodeURIComponent(postal)}&countryCode=${encodeURIComponent(cc)}`, { signal });
      if (!res.ok) return null;
      const d = await res.json();
      return d.city ? d : null;
    } catch { return null; }
  }, []);

  // Suggestions for new-customer form (billing + shipping)
  const [newBillSugg, setNewBillSugg]     = useState<PostalSugg>(null);
  const [newBillDism, setNewBillDism]     = useState(false);
  const [newShipSugg, setNewShipSugg]     = useState<PostalSugg>(null);
  const [newShipDism, setNewShipDism]     = useState(false);
  // Suggestions for edit-customer form (billing + shipping)
  const [editBillSugg, setEditBillSugg]   = useState<PostalSugg>(null);
  const [editBillDism, setEditBillDism]   = useState(false);
  const [editShipSugg, setEditShipSugg]   = useState<PostalSugg>(null);
  const [editShipDism, setEditShipDism]   = useState(false);

  // Create form
  type NewState = {
    salutation: string; title: string;
    firstName: string; lastName: string;
    institutionName: string; institutionType: string; specialty: string;
    address: string; postalCode: string; city: string; country: string; ustIdNr: string;
    email: string; phone: string; fax: string; website: string; referenceNumber: string;
    instrument: string; notes: string; treatingDoctorName: string;
    diffShipping: boolean;
    shippingAddressCopied: boolean;
    shippingFirstName: string; shippingLastName: string; shippingInstitutionName: string;
    shippingAddress: string; shippingPostalCode: string; shippingCity: string;
    shippingCountry: string; shippingPhone: string; shippingEmail: string;
  };
  const NEW_DEFAULT: NewState = {
    salutation: "", title: "", firstName: "", lastName: "",
    institutionName: "", institutionType: "Praxis", specialty: "",
    address: "", postalCode: "", city: "", country: "DE", ustIdNr: "",
    email: "", phone: "", fax: "", website: "", referenceNumber: "",
    instrument: "", notes: "", treatingDoctorName: "",
    diffShipping: false,
    shippingAddressCopied: false,
    shippingFirstName: "", shippingLastName: "", shippingInstitutionName: "",
    shippingAddress: "", shippingPostalCode: "", shippingCity: "",
    shippingCountry: "", shippingPhone: "", shippingEmail: "",
  };
  const [newState, setNewState] = useState<NewState>(NEW_DEFAULT);
  const setN = <K extends keyof NewState>(k: K, v: NewState[K]) => setNewState(s => ({ ...s, [k]: v }));

  // Certified doctors (for treating-doctor dropdown) — re-fetches when instrument changes
  const [certifiedDoctors, setCertifiedDoctors] = useState<{
    id: number;
    name: string;
    institutionName?: string | null;
  }[]>([]);
  useEffect(() => {
    const instruments = [...parseInstrument(newState.instrument)];
    const qs = instruments.map(i => `instrument=${encodeURIComponent(i)}`).join("&");
    const url = qs ? `/api/certified-doctors?${qs}` : "/api/certified-doctors";
    fetch(url)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setCertifiedDoctors(data); })
      .catch(() => {});
  }, [newState.instrument]);

  // Edit state
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [legacyEditState, setLegacyEditState] = useState<LegacyEditState | null>(null);
  const [legacyEditSaving, setLegacyEditSaving] = useState(false);
  const editStateExists = editState !== null;
  const editInstitutionName = editState?.institutionName ?? "";
  const editPostalCode = editState?.postalCode ?? "";
  const editCountry = editState?.country ?? "";
  const editShippingPostalCode = editState?.shippingPostalCode ?? "";
  const editShippingCountry = editState?.shippingCountry ?? "";
  const editVatWebsite = editState?.website ?? "";
  const editVatCity = editState?.city ?? "";

  // Postal-code → city/country suggestions (debounced, triggered by postalCode + country changes)
  // Institution name → address suggestions (new customer)
  useEffect(() => {
    const gen = ++newInstGenRef.current;
    setNewInstSuggestions([]);
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const s = await lookupInstitutionMulti(newState.institutionName, controller.signal);
      if (gen === newInstGenRef.current) setNewInstSuggestions(s);
    }, 800);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, newState.institutionName, lookupInstitutionMulti]);

  // Institution name → address suggestions (edit customer)
  useEffect(() => {
    const gen = ++editInstGenRef.current;
    setEditInstSuggestions([]);
    if (!editStateExists) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const s = await lookupInstitutionMulti(editInstitutionName, controller.signal);
      if (gen === editInstGenRef.current) setEditInstSuggestions(s);
    }, 800);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [editStateExists, editInstitutionName, lookupInstitutionMulti]);

  useEffect(() => {
    const gen = ++newBillGenRef.current;
    setNewBillSugg(null); setNewBillDism(false);
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const s = await lookupPostal(newState.postalCode, newState.country, controller.signal);
      if (gen === newBillGenRef.current) setNewBillSugg(s);
    }, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, newState.postalCode, newState.country, lookupPostal]);

  useEffect(() => {
    const gen = ++newShipGenRef.current;
    setNewShipSugg(null); setNewShipDism(false);
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const s = await lookupPostal(newState.shippingPostalCode, newState.shippingCountry, controller.signal);
      if (gen === newShipGenRef.current) setNewShipSugg(s);
    }, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, newState.shippingPostalCode, newState.shippingCountry, lookupPostal]);

  useEffect(() => {
    const gen = ++editBillGenRef.current;
    setEditBillSugg(null); setEditBillDism(false);
    if (!editStateExists) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const s = await lookupPostal(editPostalCode, editCountry, controller.signal);
      if (gen === editBillGenRef.current) setEditBillSugg(s);
    }, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [editStateExists, editPostalCode, editCountry, lookupPostal]);

  useEffect(() => {
    const gen = ++editShipGenRef.current;
    setEditShipSugg(null); setEditShipDism(false);
    if (!editStateExists) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const s = await lookupPostal(editShippingPostalCode, editShippingCountry, controller.signal);
      if (gen === editShipGenRef.current) setEditShipSugg(s);
    }, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [editStateExists, editShippingPostalCode, editShippingCountry, lookupPostal]);

  // ── VAT ID lookup effects ────────────────────────────────────────────────────

  // Signal effect — fires immediately when a suggestion is picked (zero delay).
  useEffect(() => {
    if (!newVatSignal) return;
    const signal = newVatSignal;
    const gen = ++newVatGenRef.current;
    newVatAbortRef.current?.abort();
    if (!open) return;
    const controller = new AbortController();
    newVatAbortRef.current = controller;
    setNewVatStatus("loading"); setNewVatSugg(null); setNewVatDism(false);
    lookupVat(signal.website, signal.name, signal.country, signal.city, controller.signal)
      .then(vatId => {
        if (gen !== newVatGenRef.current) return; // stale response — discard
        if (vatId) {
          setNewState((prev) => ({ ...prev, ustIdNr: vatId }));
          setNewVatSugg(vatId);
          setNewVatStatus("found");
        }
        else        { setNewVatStatus("not-found"); }
      })
      .finally(() => {
        // Do not clear a newer pick. Clearing before this request settles would
        // re-run the effect and abort the request that was just started.
        setNewVatSignal(current => current === signal ? null : current);
      });
    return () => {
      controller.abort();
      if (newVatAbortRef.current === controller) newVatAbortRef.current = null;
    };
  }, [open, newVatSignal, lookupVat]);

  useEffect(() => {
    if (!editVatSignal) return;
    const signal = editVatSignal;
    const gen = ++editVatGenRef.current;
    editVatAbortRef.current?.abort();
    setEditVatStatus("loading"); setEditVatSugg(null); setEditVatDism(false);
    const controller = new AbortController();
    editVatAbortRef.current = controller;
    lookupVat(signal.website, signal.name, signal.country, signal.city, controller.signal)
      .then(vatId => {
        if (gen !== editVatGenRef.current) return; // stale response — discard
        if (vatId) { setEditState(s => s ? { ...s, ustIdNr: vatId } : s); setEditVatSugg(vatId); setEditVatStatus("found"); }
        else        { setEditVatStatus("not-found"); }
      })
      .finally(() => {
        setEditVatSignal(current => current === signal ? null : current);
      });
    return () => {
      controller.abort();
      if (editVatAbortRef.current === controller) editVatAbortRef.current = null;
    };
  }, [editVatSignal, lookupVat]);

  // Debounced effect — fires when the user manually changes country / institutionName / website.
  useEffect(() => {
    if (newVatSuppressRef.current) { newVatSuppressRef.current = false; return; }
    const gen = ++newVatGenRef.current;
    newVatAbortRef.current?.abort();
    if (!open) return;
    const country = newState.country;
    if (!country || country === "DE") {
      setNewVatStatus("idle"); setNewVatSugg(null); setNewVatDism(false);
      return;
    }
    const name = newState.institutionName.trim();
    const web  = newState.website.trim();
    if (!name && !web) { setNewVatStatus("idle"); return; }

    setNewVatStatus("loading"); setNewVatSugg(null); setNewVatDism(false);
    const controller = new AbortController();
    newVatAbortRef.current = controller;
    const timer = setTimeout(async () => {
      const vatId = await lookupVat(web, name, country, newState.city.trim(), controller.signal);
      if (gen !== newVatGenRef.current) return; // stale response — discard
      if (vatId) {
        setNewState((prev) => ({ ...prev, ustIdNr: vatId }));
        setNewVatSugg(vatId);
        setNewVatStatus("found");
      }
      else        { setNewVatStatus("not-found"); }
    }, 1200);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (newVatAbortRef.current === controller) newVatAbortRef.current = null;
    };
  }, [open, newState.country, newState.institutionName, newState.website, newState.city, lookupVat]);

  useEffect(() => {
    if (editVatSuppressRef.current) { editVatSuppressRef.current = false; return; }
    const gen = ++editVatGenRef.current;
    editVatAbortRef.current?.abort();
    const country = editCountry;
    if (!country || country === "DE") {
      setEditVatStatus("idle"); setEditVatSugg(null); setEditVatDism(false);
      return;
    }
    const name = editInstitutionName.trim();
    const web  = editVatWebsite.trim();
    if (!name && !web) { setEditVatStatus("idle"); return; }

    setEditVatStatus("loading"); setEditVatSugg(null); setEditVatDism(false);
    const controller = new AbortController();
    editVatAbortRef.current = controller;
    const timer = setTimeout(async () => {
      const vatId = await lookupVat(web, name, country, editVatCity.trim(), controller.signal);
      if (gen !== editVatGenRef.current) return; // stale response — discard
      if (vatId) { setEditState(s => s ? { ...s, ustIdNr: vatId } : s); setEditVatSugg(vatId); setEditVatStatus("found"); }
      else        { setEditVatStatus("not-found"); }
    }, 1200);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (editVatAbortRef.current === controller) editVatAbortRef.current = null;
    };
  }, [editCountry, editInstitutionName, editVatWebsite, editVatCity, lookupVat]);

  const filtered = customers.filter(c => {
    // Invoice status filter: only show customers with draft/sent invoices
    if (pendingCustomerIds !== null && !pendingCustomerIds.has(c.id)) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ").toLowerCase();
    return (
      fullName.includes(q) ||
      c.institutionName?.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q) ||
      c.country?.toLowerCase().includes(q) ||
      c.customerNr?.toLowerCase().includes(q)
    );
  });

  const legacyFiltered = legacyCustomers.filter(c => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      [c.salutation, c.title, c.name].filter(Boolean).join(" ").toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q) ||
      c.country?.toLowerCase().includes(q) ||
      c.vatId?.toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    let av: string;
    let bv: string;
    if (sortBy === "customerNr") {
      av = a.customerNr ?? "";
      bv = b.customerNr ?? "";
    } else {
      av = [a.firstName, a.lastName].filter(Boolean).join(" ").toLowerCase();
      bv = [b.firstName, b.lastName].filter(Boolean).join(" ").toLowerCase();
    }
    const cmp = av.localeCompare(bv, undefined, { numeric: true });
    return sortDir === "asc" ? cmp : -cmp;
  });

  const handleSort = (col: "name" | "customerNr") => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };

  const allIds = sorted.map(c => c.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
  const toggleSelect = (id: number) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(allIds));

  const handleBulkDelete = async () => {
    if (!token || selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} customer(s)? This cannot be undone.`)) return;
    setDeleting(true);
    for (const id of selectedIds) await adminDelete(`/api/iroc/website-customers/${id}`, token).catch(() => {});
    setSelectedIds(new Set());
    setDeleting(false);
    void customerQuery.refetch();
  };

  const openMerge = () => {
    const [a] = Array.from(selectedIds);
    setMergePrimaryId(a); // default: first selected is primary
    setMergeOpen(true);
  };

  const handleMerge = async () => {
    if (!token || !mergePrimaryId) return;
    const [idA, idB] = Array.from(selectedIds);
    const secondaryId = mergePrimaryId === idA ? idB : idA;
    setMerging(true);
    try {
      await adminPost("/api/admin/customers/merge", token, { primaryId: mergePrimaryId, secondaryId });
      setMergeOpen(false);
      setSelectedIds(new Set());
      void customerQuery.refetch();
    } catch {
      alert(lang === "de" ? "Zusammenführen fehlgeschlagen" : "Merge failed");
    } finally {
      setMerging(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    // Validate: either personal name or institution name is required
    const hasPersonName = !!(newState.firstName.trim() && newState.lastName.trim());
    const hasInstitution = !!newState.institutionName.trim();
    if (!hasPersonName && !hasInstitution) {
      alert(lang === "de"
        ? "Bitte geben Sie Vor- und Nachname oder den Namen der Institution an."
        : "Please provide first and last name, or the institution name.");
      return;
    }
    // Non-DE customers require a VAT ID — block if lookup found nothing and field is still empty
    const isNonDe = newState.country && newState.country !== "DE";
    if (isNonDe && !newState.ustIdNr.trim() && newVatStatus === "not-found") {
      alert(lang === "de"
        ? "Bitte geben Sie die USt-IdNr. ein. Für Kunden außerhalb Deutschlands ist sie Pflichtfeld."
        : "Please enter the VAT ID. It is required for customers outside Germany.");
      return;
    }
    const hasCompleteShippingAddress = [
      newState.shippingAddress,
      newState.shippingPostalCode,
      newState.shippingCity,
      newState.shippingCountry,
    ].every(value => value.trim().length > 0);
    if ((!newState.diffShipping && !newState.shippingAddressCopied) || !hasCompleteShippingAddress) {
      alert(lang === "de"
        ? "Bitte geben Sie eine Lieferadresse ein oder übernehmen Sie die Rechnungsadresse als Lieferadresse. Straße, PLZ, Stadt und Land sind Pflichtfelder."
        : "Please enter a shipping address or copy the billing address as the shipping address. Street, postal code, city, and country are required.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, string | string[] | null> = {
        salutation: newState.salutation || null,
        title: newState.title || null,
        firstName: newState.firstName || null,
        lastName: newState.lastName || null,
        institutionName: newState.institutionName || null,
        institutionType: newState.institutionType || null,
        specialty: newState.specialty || null,
        email: newState.email,
        phone: newState.phone || null,
        fax: newState.fax || null,
        website: newState.website || null,
        referenceNumber: newState.referenceNumber || null,
        address: newState.address || null,
        postalCode: newState.postalCode || null,
        city: newState.city || null,
        country: newState.country || "DE",
        ustIdNr: newState.ustIdNr || null,
        instrument: newState.instrument,
        certifications: [...parseInstrument(newState.instrument)],
        notes: newState.notes || null,
        treatingDoctorName: newState.treatingDoctorName || null,
        shippingFirstName: newState.shippingFirstName || null,
        shippingLastName: newState.shippingLastName || null,
        shippingInstitutionName: newState.shippingInstitutionName || null,
        shippingAddress: newState.shippingAddress || null,
        shippingPostalCode: newState.shippingPostalCode || null,
        shippingCity: newState.shippingCity || null,
        shippingCountry: newState.shippingCountry || null,
        shippingPhone: newState.shippingPhone || null,
        shippingEmail: newState.shippingEmail || null,
      };
      await adminPost("/api/iroc/website-customers", token, payload);
      setOpen(false);
      setNewState(NEW_DEFAULT);
      void customerQuery.refetch();
    } catch {
      alert("Failed to create customer");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (c: WebsiteCustomer) => {
    setEditVatStatus("idle"); setEditVatSugg(null); setEditVatDism(false);
    setEditState({
      id: c.id,
      customerNr: c.customerNr ?? "",
      salutation: c.salutation ?? "",
      title: c.title ?? "",
      firstName: c.firstName ?? "",
      lastName: c.lastName ?? "",
      institutionName: c.institutionName ?? "",
      specialty: c.specialty ?? "",
      email: c.email,
      phone: c.phone ?? "",
      address: c.address ?? "",
      postalCode: c.postalCode ?? "",
      city: c.city ?? "",
      country: c.country ?? "",
      ustIdNr: c.ustIdNr ?? "",
      website: c.website ?? "",
      instrument: c.instrument,
      certifications: [...customerCertifications(c)],
      notes: c.notes ?? "",
      shippingFirstName: c.shippingFirstName ?? "",
      shippingLastName: c.shippingLastName ?? "",
      shippingInstitutionName: c.shippingInstitutionName ?? "",
      shippingAddress: c.shippingAddress ?? "",
      shippingPostalCode: c.shippingPostalCode ?? "",
      shippingCity: c.shippingCity ?? "",
      shippingCountry: c.shippingCountry ?? "",
      shippingPhone: c.shippingPhone ?? "",
      shippingEmail: c.shippingEmail ?? "",
    });
  };

  const set = <K extends keyof EditState>(key: K, value: EditState[K]) =>
    setEditState(s => s ? { ...s, [key]: value } : s);

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editState) return;
    // Non-DE customers require a VAT ID — block if lookup found nothing and field is still empty
    const editIsNonDe = editState.country && editState.country !== "DE";
    if (editIsNonDe && !editState.ustIdNr.trim() && editVatStatus === "not-found") {
      alert(lang === "de"
        ? "Bitte geben Sie die USt-IdNr. ein. Für Kunden außerhalb Deutschlands ist sie Pflichtfeld."
        : "Please enter the VAT ID. It is required for customers outside Germany.");
      return;
    }
    setEditSaving(true);
    try {
      await adminPatch(`/api/admin/customers/${editState.id}`, token, {
        customerNr: editState.customerNr || null,
        salutation: editState.salutation || null,
        title: editState.title || null,
        firstName: editState.firstName || null,
        lastName: editState.lastName || null,
        institutionName: editState.institutionName || null,
        specialty: editState.specialty || null,
        email: editState.email,
        phone: editState.phone || null,
        address: editState.address || null,
        postalCode: editState.postalCode || null,
        city: editState.city || null,
        country: editState.country || null,
        ustIdNr: editState.ustIdNr || null,
        website: editState.website || null,
        instrument: editState.instrument,
        certifications: editState.certifications,
        notes: editState.notes || null,
        shippingFirstName: editState.shippingFirstName || null,
        shippingLastName: editState.shippingLastName || null,
        shippingInstitutionName: editState.shippingInstitutionName || null,
        shippingAddress: editState.shippingAddress || null,
        shippingPostalCode: editState.shippingPostalCode || null,
        shippingCity: editState.shippingCity || null,
        shippingCountry: editState.shippingCountry || null,
        shippingPhone: editState.shippingPhone || null,
        shippingEmail: editState.shippingEmail || null,
      });
      setEditState(null);
      void customerQuery.refetch();
    } catch {
      alert(lang === "de" ? "Speichern fehlgeschlagen" : "Failed to save");
    } finally {
      setEditSaving(false);
    }
  };

  const openLegacyEdit = (c: LegacyCustomer) => {
    setLegacyEditState({
      id: c.id,
      salutation: c.salutation ?? "",
      title: c.title ?? "",
      name: c.name,
      company: c.company ?? "",
      address: c.address ?? "",
      city: c.city ?? "",
      postalCode: c.postalCode ?? "",
      country: c.country ?? "",
      vatId: c.vatId ?? "",
      isEu: c.isEu,
      email: c.email ?? "",
      phone: c.phone ?? "",
      notes: c.notes ?? "",
    });
  };

  const openLegacyCreate = () => {
    setLegacyEditState({
      id: null,
      salutation: "",
      title: "",
      name: "",
      company: "",
      address: "",
      city: "",
      postalCode: "",
      country: "Germany",
      vatId: "",
      isEu: false,
      email: "",
      phone: "",
      notes: "",
    });
  };

  const setLegacy = <K extends keyof LegacyEditState>(key: K, value: LegacyEditState[K]) =>
    setLegacyEditState(s => s ? { ...s, [key]: value } : s);

  const handleLegacySave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !legacyEditState) return;
    if (!legacyEditState.name.trim()) {
      alert(lang === "de" ? "Bitte geben Sie einen Namen ein." : "Please enter a name.");
      return;
    }
    setLegacyEditSaving(true);
    try {
      const payload = {
        salutation: legacyEditState.salutation || null,
        title: legacyEditState.title || null,
        name: normalizeLegacyCustomerName(legacyEditState.name, legacyEditState.title),
        company: legacyEditState.company || null,
        address: legacyEditState.address || null,
        city: legacyEditState.city || null,
        postalCode: legacyEditState.postalCode || null,
        country: legacyEditState.country || "Germany",
        vatId: legacyEditState.vatId || null,
        isEu: legacyEditState.isEu,
        email: legacyEditState.email || null,
        phone: legacyEditState.phone || null,
        notes: legacyEditState.notes || null,
      };
      if (legacyEditState.id === null) {
        await adminPost("/api/iroc/customers", token, payload);
      } else {
        await adminPatch(`/api/iroc/customers/${legacyEditState.id}`, token, payload);
      }
      setLegacyEditState(null);
      void customerQuery.refetch();
    } catch {
      alert(lang === "de" ? "Speichern fehlgeschlagen" : "Failed to save customer");
    } finally {
      setLegacyEditSaving(false);
    }
  };

  const selectCls = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t("customers", lang)}</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />{t("new_customer", lang)}</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden max-w-2xl">
            <DialogHeader className="shrink-0">
              <DialogTitle>{t("new_customer", lang)}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 pt-2 overflow-y-auto flex-1 pr-1">

              {/* ── Personal ── */}
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Anrede" : "Salutation"}</Label>
                  <select value={newState.salutation} onChange={e => setN("salutation", e.target.value)} className={selectCls}>
                    <option value="">—</option>
                    <option value="Herr">{lang === "de" ? "Herr" : "Mr."}</option>
                    <option value="Frau">{lang === "de" ? "Frau" : "Mrs."}</option>
                    <option value="Divers">{lang === "de" ? "Divers" : "Diverse"}</option>
                    <option value="Andere">{lang === "de" ? "Andere" : "Other"}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Titel" : "Title"}</Label>
                  <Input value={newState.title} onChange={e => setN("title", e.target.value)} placeholder="Dr., Prof., …" />
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Vorname" : "First Name"}</Label>
                  <Input value={newState.firstName} onChange={e => setN("firstName", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Nachname" : "Last Name"}</Label>
                  <Input value={newState.lastName} onChange={e => setN("lastName", e.target.value)} />
                </div>
              </div>

              {/* ── Institution ── */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2 col-span-2">
                  <Label>{lang === "de" ? "Name der Institution" : "Institution Name"}</Label>
                  <div className="relative">
                    <Input
                      value={newState.institutionName}
                      onChange={e => setN("institutionName", e.target.value)}
                      onBlur={() => setTimeout(() => setNewInstSuggestions([]), 150)}
                    />
                    {newInstSuggestions.length > 0 && (
                      <ul className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-md shadow-lg max-h-56 overflow-y-auto">
                        {newInstSuggestions.map((s, i) => (
                          <li key={i}
                            className="px-3 py-2 cursor-pointer hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              const name = s.displayName.split(',')[0].trim();
                              if (name)          setN("institutionName", name);
                              if (s.address)     setN("address",         s.address);
                              if (s.postalCode)  setN("postalCode",      s.postalCode);
                              if (s.city)        setN("city",            s.city);
                              if (s.countryCode) setN("country",         s.countryCode);
                              setNewInstSuggestions([]);
                              // Signal an immediate VAT lookup when the institution is outside Germany
                              if (s.countryCode && s.countryCode !== "DE") {
                                newVatSuppressRef.current = true; // signal effect handles this lookup
                                setN("ustIdNr", ""); // clear any stale value first
                                setNewVatSignal({ name: name || newState.institutionName, website: newState.website || "", country: s.countryCode, city: s.city || "" });
                              }
                            }}>
                            <div className="text-sm font-medium">{s.displayName.split(',')[0].trim()}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{[s.address, s.postalCode, s.city, s.countryCode].filter(Boolean).join(' · ')}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Art der Institution" : "Institution Type"}</Label>
                  <select value={newState.institutionType} onChange={e => setN("institutionType", e.target.value)} className={selectCls}>
                    <option value="Krankenhaus">{lang === "de" ? "Krankenhaus" : "Hospital"}</option>
                    <option value="Klinik">{lang === "de" ? "Klinik" : "Clinic"}</option>
                    <option value="Praxis">{lang === "de" ? "Praxis" : "Practice"}</option>
                    <option value="Andere">{lang === "de" ? "Andere" : "Other"}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Fachgebiet" : "Specialty"}</Label>
                  <Input value={newState.specialty} onChange={e => setN("specialty", e.target.value)} />
                </div>
              </div>

              {/* ── Billing address ── */}
              <div className="border-t pt-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                  {lang === "de" ? "Rechnungsadresse" : "Billing Address"}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2 col-span-2">
                    <Label>{lang === "de" ? "Straße und Hausnummer" : "Address"}</Label>
                    <Input value={newState.address} onChange={e => setN("address", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>PLZ</Label>
                    <Input value={newState.postalCode} onChange={e => setN("postalCode", e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div className="space-y-2">
                    <Label>{lang === "de" ? "Stadt" : "City"}</Label>
                    <Input value={newState.city} onChange={e => setN("city", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{lang === "de" ? "Land" : "Country"}</Label>
                    <CountrySelect value={newState.country} onChange={v => setN("country", v)} lang={lang} />
                  </div>
                  {/* Postal suggestion (new billing) */}
                  {newBillSugg && !newBillDism && (
                    <div className="col-span-3 flex items-center gap-2 text-xs bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                      <span className="flex-1 text-blue-800">💡 {lang === "de" ? "Vorschlag" : "Suggestion"}: <strong>{newBillSugg.city}</strong>{newBillSugg.countryCode && <>, <strong>{newBillSugg.countryCode}</strong></>}</span>
                      <button type="button" className="px-2 py-0.5 bg-blue-100 rounded text-blue-800 hover:bg-blue-200 font-medium whitespace-nowrap" onClick={() => { if (newBillSugg.city) setN("city", newBillSugg.city); if (newBillSugg.countryCode) setN("country", newBillSugg.countryCode); if (newBillSugg.postcode) setN("postalCode", newBillSugg.postcode); setNewBillSugg(null); }}>{lang === "de" ? "Übernehmen" : "Apply"}</button>
                      <button type="button" className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-blue-500" onClick={() => setNewBillDism(true)}>✕</button>
                    </div>
                  )}
                  {/* USt-IdNr — required for non-DE customers */}
                  <div className="space-y-2">
                    {(() => {
                      const isNonDe = newState.country && newState.country !== "DE";
                      const required = isNonDe && newVatStatus === "not-found" && !newState.ustIdNr.trim();
                      return (
                        <>
                          <Label className={required ? "text-red-600" : ""}>
                            USt-IdNr.{isNonDe ? " *" : ""}
                            {newVatStatus === "loading" && (
                              <span className="ml-2 text-xs text-muted-foreground animate-pulse">
                                {lang === "de" ? "Suche…" : "Looking up…"}
                              </span>
                            )}
                          </Label>
                          <Input
                            value={newState.ustIdNr}
                            onChange={e => { newVatGenRef.current++; newVatAbortRef.current?.abort(); setN("ustIdNr", e.target.value); if (e.target.value.trim()) { setNewVatStatus("idle"); setNewVatSugg(null); } }}
                            className={required ? "border-red-400 focus-visible:ring-red-400" : ""}
                            placeholder={isNonDe ? (lang === "de" ? "Pflichtfeld für Nicht-DE" : "Required for non-DE") : ""}
                          />
                          {/* Suggestion banner */}
                          {newVatSugg && !newVatDism && (
                            <div className="flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                              <span className="flex-1 text-emerald-800">
                                🔍 {lang === "de" ? "Gefunden" : "Found"}: <strong>{newVatSugg}</strong>
                              </span>
                              <button type="button" className="px-2 py-0.5 bg-emerald-100 rounded text-emerald-800 hover:bg-emerald-200 font-medium whitespace-nowrap"
                                onClick={() => { setN("ustIdNr", newVatSugg); setNewVatSugg(null); setNewVatStatus("idle"); }}>
                                {lang === "de" ? "Übernehmen" : "Apply"}
                              </button>
                              <button type="button" className="px-1.5 py-0.5 rounded hover:bg-emerald-100 text-emerald-500"
                                onClick={() => setNewVatDism(true)}>✕</button>
                            </div>
                          )}
                          {/* Not-found notice */}
                          {required && (
                            <p className="text-xs text-red-600">
                              {lang === "de"
                                ? "Konnte nicht automatisch ermittelt werden – bitte manuell eintragen."
                                : "Could not be found automatically – please enter manually."}
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* ── Contact ── */}
              <div className="border-t pt-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                  {lang === "de" ? "Kontakt" : "Contact"}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{t("email", lang)} *</Label>
                    <Input type="email" value={newState.email} onChange={e => setN("email", e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>{lang === "de" ? "Telefon" : "Phone"}</Label>
                    <Input value={newState.phone} onChange={e => setN("phone", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{lang === "de" ? "Fax" : "Fax"}</Label>
                    <Input value={newState.fax} onChange={e => setN("fax", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Website</Label>
                    <Input value={newState.website} onChange={e => setN("website", e.target.value)} placeholder="https://…" />
                  </div>
                  <div className="space-y-2">
                    <Label>{lang === "de" ? "Referenznummer" : "Reference Number"}</Label>
                    <Input value={newState.referenceNumber} onChange={e => setN("referenceNumber", e.target.value)} />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>{lang === "de" ? "Behandelnder / Bestellender Arzt" : "Treating / Ordering Doctor"}</Label>
                    <Input
                      value={newState.treatingDoctorName}
                      onChange={e => setN("treatingDoctorName", e.target.value)}
                      list="new-customer-doctors-list"
                      placeholder={lang === "de" ? "Titel Nachname eingeben oder auswählen …" : "Enter or select title + last name …"}
                    />
                    <datalist id="new-customer-doctors-list">
                      {certifiedDoctors.map(d => (
                        <option
                          key={d.id}
                          value={d.name}
                          label={d.institutionName?.trim() || undefined}
                        />
                      ))}
                    </datalist>
                  </div>
                  <div className="space-y-2">
                    <Label>{lang === "de" ? "Produkt / Gruppe" : "Product / Group"}</Label>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
                      {productGroups.map(g => {
                        const checked = parseInstrument(newState.instrument).has(g.key);
                        return (
                          <label key={g.key} className="flex items-center gap-2 cursor-pointer text-sm select-none">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={v => {
                                const s = parseInstrument(newState.instrument);
                                if (v) s.add(g.key); else s.delete(g.key);
                                setN("instrument", serializeInstrument(s));
                              }}
                            />
                            {lang === "de" ? g.nameDe : g.nameEn}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Shipping address toggle ── */}
              <div className="border-t pt-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={newState.diffShipping}
                      onChange={e => setNewState(s => ({
                        ...s,
                        diffShipping: e.target.checked,
                        shippingAddressCopied: false,
                      }))}
                      className="h-4 w-4 rounded border border-input"
                    />
                    {lang === "de" ? "Abweichende Lieferadresse" : "Different shipping address"}
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => setNewState(s => ({
                      ...s,
                      diffShipping: false,
                      shippingAddressCopied: true,
                      shippingFirstName: s.firstName,
                      shippingLastName: s.lastName,
                      shippingInstitutionName: s.institutionName,
                      shippingAddress: s.address,
                      shippingPostalCode: s.postalCode,
                      shippingCity: s.city,
                      shippingCountry: s.country,
                      shippingPhone: s.phone,
                      shippingEmail: s.email,
                    }))}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {lang === "de" ? "Rechnungsadresse übernehmen" : "Copy billing address"}
                  </Button>
                  {newState.shippingAddressCopied && (
                    <span className="text-xs text-muted-foreground">
                      {lang === "de" ? "Als Lieferadresse übernommen" : "Copied as shipping address"}
                    </span>
                  )}
                </div>
              </div>

              {newState.diffShipping && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {lang === "de" ? "Lieferadresse" : "Shipping Address"}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>{lang === "de" ? "Vorname" : "First Name"}</Label>
                      <Input value={newState.shippingFirstName} onChange={e => setN("shippingFirstName", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>{lang === "de" ? "Nachname" : "Last Name"}</Label>
                      <Input value={newState.shippingLastName} onChange={e => setN("shippingLastName", e.target.value)} />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>{lang === "de" ? "Institution" : "Institution"}</Label>
                      <Input value={newState.shippingInstitutionName} onChange={e => setN("shippingInstitutionName", e.target.value)} />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>{lang === "de" ? "Straße und Hausnummer" : "Address"}</Label>
                      <Input value={newState.shippingAddress} onChange={e => setN("shippingAddress", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>PLZ</Label>
                      <Input value={newState.shippingPostalCode} onChange={e => setN("shippingPostalCode", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>{lang === "de" ? "Stadt" : "City"}</Label>
                      <Input value={newState.shippingCity} onChange={e => setN("shippingCity", e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>{lang === "de" ? "Land" : "Country"}</Label>
                      <CountrySelect value={newState.shippingCountry} onChange={v => setN("shippingCountry", v)} lang={lang} />
                    </div>
                    {/* Postal suggestion (new shipping) */}
                    {newShipSugg && !newShipDism && (
                      <div className="col-span-2 flex items-center gap-2 text-xs bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                        <span className="flex-1 text-blue-800">💡 {lang === "de" ? "Vorschlag" : "Suggestion"}: <strong>{newShipSugg.city}</strong>{newShipSugg.countryCode && <>, <strong>{newShipSugg.countryCode}</strong></>}</span>
                        <button type="button" className="px-2 py-0.5 bg-blue-100 rounded text-blue-800 hover:bg-blue-200 font-medium whitespace-nowrap" onClick={() => { if (newShipSugg.city) setN("shippingCity", newShipSugg.city); if (newShipSugg.countryCode) setN("shippingCountry", newShipSugg.countryCode); if (newShipSugg.postcode) setN("shippingPostalCode", newShipSugg.postcode); setNewShipSugg(null); }}>{lang === "de" ? "Übernehmen" : "Apply"}</button>
                        <button type="button" className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-blue-500" onClick={() => setNewShipDism(true)}>✕</button>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>{lang === "de" ? "Telefon" : "Phone"}</Label>
                      <Input value={newState.shippingPhone} onChange={e => setN("shippingPhone", e.target.value)} />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label>E-Mail</Label>
                      <Input type="email" value={newState.shippingEmail} onChange={e => setN("shippingEmail", e.target.value)} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Notes ── */}
              <div className="space-y-2">
                <Label>{lang === "de" ? "Anmerkungen" : "Notes"}</Label>
                <textarea
                  value={newState.notes}
                  onChange={e => setN("notes", e.target.value)}
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <DialogFooter className="mt-2 shrink-0">
                <Button variant="outline" type="button" onClick={() => { setOpen(false); setNewState(NEW_DEFAULT); }}>{t("cancel", lang)}</Button>
                <Button type="submit" disabled={saving}>{saving ? (lang === "de" ? "Speichere…" : "Saving…") : t("save", lang)}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center space-x-2 bg-card border rounded-md p-1 max-w-sm">
          <Search className="h-4 w-4 ml-2 text-muted-foreground" />
          <Input placeholder={lang === "de" ? "Suchen…" : "Search..."} value={search} onChange={e => setSearch(e.target.value)}
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-2 bg-transparent" />
        </div>

        {invoiceStatusFilter && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md text-sm text-blue-700 dark:text-blue-400">
            <span>{lang === "de" ? "Filter: Offene Bestellungen (Entwurf & Gesendet)" : "Filter: Open Orders (Draft & Sent)"}</span>
            <button
              onClick={() => setInvoiceStatusFilter(false)}
              className="hover:text-blue-900 dark:hover:text-blue-200 transition-colors"
              aria-label="Clear filter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={toggleAll} className="h-7 gap-1.5 text-xs">
          {allSelected ? (lang === "de" ? "Auswahl aufheben" : "Deselect all") : (lang === "de" ? "Alle auswählen" : "Select all")}
        </Button>
        {selectedIds.size > 0 && (
          <>
            <span className="font-medium text-destructive text-sm">{selectedIds.size} {lang === "de" ? "ausgewählt" : "selected"}</span>
            {selectedIds.size === 2 && (
              <Button size="sm" variant="outline" onClick={openMerge} className="gap-1.5 h-7 border-primary/40 text-primary hover:bg-primary/10">
                <Merge className="h-3.5 w-3.5" />
                {lang === "de" ? "Zusammenführen" : "Merge"}
              </Button>
            )}
            <Button size="sm" variant="destructive" disabled={deleting} onClick={handleBulkDelete} className="gap-1.5 h-7">
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? (lang === "de" ? "Lösche…" : "Deleting…") : `${lang === "de" ? "Löschen" : "Delete"} (${selectedIds.size})`}
            </Button>
          </>
        )}
      </div>

      <div className="border rounded-md bg-card">
        <div className="overflow-y-auto max-h-[60vh] sticky-header-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px] cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("customerNr")}>
                <div className="flex items-center gap-1">
                  {lang === "de" ? "Kd.-Nr." : "Cust. Nr."}
                  {sortBy === "customerNr" ? (sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />) : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/30" />}
                </div>
              </TableHead>
              <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("name")}>
                <div className="flex items-center gap-1">
                  {t("name", lang)}
                  {sortBy === "name" ? (sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />) : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/30" />}
                </div>
              </TableHead>
              <TableHead>{lang === "de" ? "Institution" : "Institution"}</TableHead>
              <TableHead>{t("email", lang)}</TableHead>
              <TableHead>{t("country", lang)}</TableHead>
              <TableHead>{lang === "de" ? "Produkt" : "Instrument"}</TableHead>
              <TableHead className="w-[110px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !retryInProgress ? (
              [1,2,3,4,5].map(i => (
                <TableRow key={i}>
                  {[1,2,3,4,5,6,7].map(j => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}
                </TableRow>
              ))
             ) : customerQuery.isError || retryInProgress || (!customerQuery.data && !loading) ? (
               <TableRow>
                 <TableCell colSpan={7} className="h-24 text-center text-destructive" role="alert">
                   <div className="flex flex-col items-center justify-center gap-2">
                     <span>
                       {lang === "de"
                         ? "Kunden konnten nicht geladen werden."
                         : "Failed to load customers."}
                     </span>
                     <Button
                       variant="outline"
                       size="sm"
                       disabled={customerQuery.isFetching || retryInProgress}
                       onClick={() => { void handleRetry(); }}
                       className="gap-1.5"
                     >
                       <RotateCcw className={`h-3.5 w-3.5 ${customerQuery.isFetching || retryInProgress ? "animate-spin" : ""}`} />
                       {customerQuery.isFetching || retryInProgress
                         ? (lang === "de" ? "Wird erneut geladen…" : "Retrying…")
                         : (lang === "de" ? "Erneut versuchen" : "Retry")}
                     </Button>
                   </div>
                 </TableCell>
               </TableRow>
             ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">{t("no_data", lang)}</TableCell>
              </TableRow>
            ) : (
              sorted.map(c => {
                const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email;
                const isEu = EU_COUNTRIES.has(normalizeCountryToIso(c.country));
                return (
                  <TableRow
                    key={c.id}
                    data-state={selectedIds.has(c.id) ? "selected" : undefined}
                    onClick={() => toggleSelect(c.id)}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.customerNr || "—"}</TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/customers/${c.id}`} className="hover:underline" onClick={e => e.stopPropagation()}>{fullName}</Link>
                    </TableCell>
                    <TableCell>
                      {c.institutionName ? (
                        <div className="flex items-center gap-2">
                          <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate max-w-[180px]">{c.institutionName}</span>
                        </div>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="text-sm">{c.email}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm">{formatCountry(c.country, lang)}</span>
                        {isEu && <Badge variant="secondary" className="text-[10px] py-0">EU</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(() => {
                          const keys = [...customerCertifications(c)];
                          if (keys.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
                          return keys.map(key => {
                            const g = productGroups.find(pg => pg.key === key);
                            const label = g ? (lang === "de" ? g.nameDe : g.nameEn) : (LEGACY_LABELS[key] ?? key);
                            return <Badge key={key} variant="outline" className="text-[10px]">{label}</Badge>;
                          });
                        })()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => { e.stopPropagation(); openEdit(c); }} title={lang === "de" ? "Bearbeiten" : "Edit"}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild title={lang === "de" ? "Ansehen" : "View"}>
                          <Link href={`/customers/${c.id}`} onClick={e => e.stopPropagation()}><Eye className="h-4 w-4" /></Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        </div>
      </div>

      {/* Legacy iROC customers */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              {lang === "de" ? "Legacy-iROC-Kunden" : "Legacy iROC Customers"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {lang === "de"
                ? "Kunden aus dem früheren iROC-System"
                : "Customers from the former iROC system"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{legacyFiltered.length}</Badge>
            <Button size="sm" onClick={openLegacyCreate}>
              <Plus className="h-4 w-4 mr-2" />
              {lang === "de" ? "Legacy-Kunde" : "Legacy customer"}
            </Button>
          </div>
        </div>
        <div className="border rounded-md bg-card">
          <div className="overflow-y-auto max-h-[45vh] sticky-header-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name", lang)}</TableHead>
                  <TableHead>{lang === "de" ? "Unternehmen" : "Company"}</TableHead>
                  <TableHead>{t("email", lang)}</TableHead>
                  <TableHead>{t("country", lang)}</TableHead>
                  <TableHead className="w-[70px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  [1, 2, 3].map(i => (
                    <TableRow key={i}>
                      {[1, 2, 3, 4, 5].map(j => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}
                    </TableRow>
                  ))
                ) : legacyFiltered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                      {search
                        ? (lang === "de" ? "Keine Legacy-Kunden gefunden" : "No legacy customers found")
                        : (lang === "de" ? "Keine Legacy-Kunden vorhanden" : "No legacy customers")}
                    </TableCell>
                  </TableRow>
                ) : (
                  legacyFiltered.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {legacyCustomerDisplayName(c)}
                      </TableCell>
                      <TableCell>
                        {c.company ? (
                          <div className="flex items-center gap-2">
                            <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-[220px]">{c.company}</span>
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-sm">{c.email || "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{formatCountry(c.country, lang)}</span>
                          {c.isEu && <Badge variant="secondary" className="text-[10px] py-0">EU</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openLegacyEdit(c)}
                            title={lang === "de" ? "Bearbeiten" : "Edit"}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      {/* Merge Dialog */}
      <Dialog open={mergeOpen} onOpenChange={o => { if (!o) setMergeOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{lang === "de" ? "Kunden zusammenführen" : "Merge Customers"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2 text-sm">
            <p className="text-muted-foreground">
              {lang === "de"
                ? "Wähle den primären Eintrag (wird behalten). Der andere Datensatz wird gelöscht – seine Rechnungen werden dem primären Eintrag zugewiesen."
                : "Choose the primary record to keep. The other record will be deleted — its invoices will be reassigned to the primary."}
            </p>
            {Array.from(selectedIds).map(id => {
              const c = customers.find(x => x.id === id);
              if (!c) return null;
              const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email;
              const isPrimary = mergePrimaryId === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMergePrimaryId(id)}
                  className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${isPrimary ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{name}</div>
                      <div className="text-muted-foreground text-xs mt-0.5">{c.email}{c.institutionName ? ` · ${c.institutionName}` : ""}{c.customerNr ? ` · #${c.customerNr}` : ""}</div>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${isPrimary ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      {isPrimary ? (lang === "de" ? "Primär (behalten)" : "Primary (keep)") : (lang === "de" ? "Wird gelöscht" : "Will be deleted")}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" type="button" onClick={() => setMergeOpen(false)}>{lang === "de" ? "Abbrechen" : "Cancel"}</Button>
            <Button variant="destructive" disabled={merging || !mergePrimaryId} onClick={handleMerge}>
              {merging ? (lang === "de" ? "Führe zusammen…" : "Merging…") : (lang === "de" ? "Zusammenführen" : "Merge")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editState} onOpenChange={open => { if (!open) setEditState(null); }}>
        <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden max-w-2xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>{lang === "de" ? "Kunden bearbeiten" : "Edit Customer"}</DialogTitle>
          </DialogHeader>
          {editState && (
            <form onSubmit={handleEditSave} className="space-y-4 pt-2 overflow-y-auto flex-1 pr-1">
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Kunden-Nr." : "Customer Nr."}</Label>
                  <Input value={editState.customerNr} onChange={e => set("customerNr", e.target.value)} placeholder="—" />
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Anrede" : "Salutation"}</Label>
                  <select value={editState.salutation} onChange={e => set("salutation", e.target.value)} className={selectCls}>
                    <option value="">—</option>
                    <option value="Herr">{lang === "de" ? "Herr" : "Mr"}</option>
                    <option value="Frau">{lang === "de" ? "Frau" : "Mrs"}</option>
                    <option value="Divers">{lang === "de" ? "Divers" : "Diverse"}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Akad. Titel" : "Degree"}</Label>
                  <Input value={editState.title} onChange={e => set("title", e.target.value)} placeholder="Dr., Prof., …" />
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Vorname" : "First Name"}</Label>
                  <Input value={editState.firstName} onChange={e => set("firstName", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2 col-span-2">
                  <Label>{lang === "de" ? "Nachname" : "Last Name"}</Label>
                  <Input value={editState.lastName} onChange={e => set("lastName", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Institution / Praxis" : "Institution / Practice"}</Label>
                  <div className="relative">
                    <Input
                      value={editState.institutionName}
                      onChange={e => set("institutionName", e.target.value)}
                      onBlur={() => setTimeout(() => setEditInstSuggestions([]), 150)}
                    />
                    {editInstSuggestions.length > 0 && (
                      <ul className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-md shadow-lg max-h-56 overflow-y-auto">
                        {editInstSuggestions.map((s, i) => (
                          <li key={i}
                            className="px-3 py-2 cursor-pointer hover:bg-blue-50 border-b border-gray-100 last:border-b-0"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              const name = s.displayName.split(',')[0].trim();
                              if (name)          set("institutionName", name);
                              if (s.address)     set("address",         s.address);
                              if (s.postalCode)  set("postalCode",      s.postalCode);
                              if (s.city)        set("city",            s.city);
                              if (s.countryCode) set("country",         s.countryCode);
                              setEditInstSuggestions([]);
                              // Signal an immediate VAT lookup when the institution is outside Germany.
                              // Clear any stale ustIdNr so it gets replaced with the correct one.
                              if (s.countryCode && s.countryCode !== "DE") {
                                editVatSuppressRef.current = true; // signal effect handles this lookup
                                set("ustIdNr", "");
                                setEditVatSignal({ name: name || editState?.institutionName || "", website: editState?.website || "", country: s.countryCode, city: s.city || "" });
                              }
                            }}>
                            <div className="text-sm font-medium">{s.displayName.split(',')[0].trim()}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{[s.address, s.postalCode, s.city, s.countryCode].filter(Boolean).join(' · ')}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Fachgebiet" : "Specialty"}</Label>
                  <Input value={editState.specialty} onChange={e => set("specialty", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t("email", lang)} *</Label>
                  <Input type="email" value={editState.email} onChange={e => set("email", e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Telefon" : "Phone"}</Label>
                  <Input value={editState.phone} onChange={e => set("phone", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2 col-span-2">
                  <Label>{lang === "de" ? "Adresse" : "Address"}</Label>
                  <Input value={editState.address} onChange={e => set("address", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>PLZ</Label>
                  <Input value={editState.postalCode} onChange={e => set("postalCode", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Stadt" : "City"}</Label>
                  <Input value={editState.city} onChange={e => set("city", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t("country", lang)}</Label>
                  <CountrySelect value={editState.country} onChange={v => set("country", v)} lang={lang} />
                </div>
                {/* Postal suggestion (edit billing) */}
                {editBillSugg && !editBillDism && (
                  <div className="col-span-3 flex items-center gap-2 text-xs bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                    <span className="flex-1 text-blue-800">💡 {lang === "de" ? "Vorschlag" : "Suggestion"}: <strong>{editBillSugg.city}</strong>{editBillSugg.countryCode && <>, <strong>{editBillSugg.countryCode}</strong></>}</span>
                    <button type="button" className="px-2 py-0.5 bg-blue-100 rounded text-blue-800 hover:bg-blue-200 font-medium whitespace-nowrap" onClick={() => { if (editBillSugg.city) set("city", editBillSugg.city); if (editBillSugg.countryCode) set("country", editBillSugg.countryCode); if (editBillSugg.postcode) set("postalCode", editBillSugg.postcode); setEditBillSugg(null); }}>{lang === "de" ? "Übernehmen" : "Apply"}</button>
                    <button type="button" className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-blue-500" onClick={() => setEditBillDism(true)}>✕</button>
                  </div>
                )}
                {/* USt-IdNr — required for non-DE customers */}
                {(() => {
                  const isNonDe = editState.country && editState.country !== "DE";
                  const required = isNonDe && editVatStatus === "not-found" && !editState.ustIdNr.trim();
                  return (
                    <div className="space-y-2">
                      <Label className={required ? "text-red-600" : ""}>
                        USt-IdNr.{isNonDe ? " *" : ""}
                        {editVatStatus === "loading" && (
                          <span className="ml-2 text-xs text-muted-foreground animate-pulse">
                            {lang === "de" ? "Suche…" : "Looking up…"}
                          </span>
                        )}
                      </Label>
                      <Input
                        value={editState.ustIdNr}
                        onChange={e => { editVatGenRef.current++; editVatAbortRef.current?.abort(); set("ustIdNr", e.target.value); if (e.target.value.trim()) { setEditVatStatus("idle"); setEditVatSugg(null); } }}
                        className={required ? "border-red-400 focus-visible:ring-red-400" : ""}
                        placeholder={isNonDe ? (lang === "de" ? "Pflichtfeld für Nicht-DE" : "Required for non-DE") : ""}
                      />
                      {editVatSugg && !editVatDism && (
                        <div className="flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                          <span className="flex-1 text-emerald-800">
                            🔍 {lang === "de" ? "Gefunden" : "Found"}: <strong>{editVatSugg}</strong>
                          </span>
                          <button type="button" className="px-2 py-0.5 bg-emerald-100 rounded text-emerald-800 hover:bg-emerald-200 font-medium whitespace-nowrap"
                            onClick={() => { set("ustIdNr", editVatSugg); setEditVatSugg(null); setEditVatStatus("idle"); }}>
                            {lang === "de" ? "Übernehmen" : "Apply"}
                          </button>
                          <button type="button" className="px-1.5 py-0.5 rounded hover:bg-emerald-100 text-emerald-500"
                            onClick={() => setEditVatDism(true)}>✕</button>
                        </div>
                      )}
                      {required && (
                        <p className="text-xs text-red-600">
                          {lang === "de"
                            ? "Konnte nicht automatisch ermittelt werden – bitte manuell eintragen."
                            : "Could not be found automatically – please enter manually."}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="space-y-2">
                <Label>Website</Label>
                <Input value={editState.website} onChange={e => set("website", e.target.value)} placeholder="https://…" />
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Produkt / Gruppe" : "Product / Group"}</Label>
                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
                  {productGroups.map(g => {
                    const checked = editState.certifications.includes(g.key);
                    return (
                      <label key={g.key} className="flex items-center gap-2 cursor-pointer text-sm select-none">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={v => {
                            const s = new Set(editState.certifications);
                            if (v) s.add(g.key); else s.delete(g.key);
                            set("certifications", [...s].sort());
                          }}
                        />
                        {lang === "de" ? g.nameDe : g.nameEn}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Notizen" : "Notes"}</Label>
                <Input value={editState.notes} onChange={e => set("notes", e.target.value)} />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1 pt-1">
                {lang === "de" ? "Lieferadresse (falls abweichend)" : "Shipping Address (if different)"}
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Vorname" : "First Name"}</Label>
                  <Input value={editState.shippingFirstName} onChange={e => set("shippingFirstName", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Nachname" : "Last Name"}</Label>
                  <Input value={editState.shippingLastName} onChange={e => set("shippingLastName", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Institution" : "Institution"}</Label>
                  <Input value={editState.shippingInstitutionName} onChange={e => set("shippingInstitutionName", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2 col-span-2">
                  <Label>{lang === "de" ? "Straße und Hausnummer" : "Street & No."}</Label>
                  <Input value={editState.shippingAddress} onChange={e => set("shippingAddress", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>PLZ</Label>
                  <Input value={editState.shippingPostalCode} onChange={e => set("shippingPostalCode", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Stadt" : "City"}</Label>
                  <Input value={editState.shippingCity} onChange={e => set("shippingCity", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Land" : "Country"}</Label>
                  <CountrySelect value={editState.shippingCountry} onChange={v => set("shippingCountry", v)} lang={lang} />
                </div>
                {/* Postal suggestion (edit shipping) */}
                {editShipSugg && !editShipDism && (
                  <div className="col-span-3 flex items-center gap-2 text-xs bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                    <span className="flex-1 text-blue-800">💡 {lang === "de" ? "Vorschlag" : "Suggestion"}: <strong>{editShipSugg.city}</strong>{editShipSugg.countryCode && <>, <strong>{editShipSugg.countryCode}</strong></>}</span>
                    <button type="button" className="px-2 py-0.5 bg-blue-100 rounded text-blue-800 hover:bg-blue-200 font-medium whitespace-nowrap" onClick={() => { if (editShipSugg.city) set("shippingCity", editShipSugg.city); if (editShipSugg.countryCode) set("shippingCountry", editShipSugg.countryCode); if (editShipSugg.postcode) set("shippingPostalCode", editShipSugg.postcode); setEditShipSugg(null); }}>{lang === "de" ? "Übernehmen" : "Apply"}</button>
                    <button type="button" className="px-1.5 py-0.5 rounded hover:bg-blue-100 text-blue-500" onClick={() => setEditShipDism(true)}>✕</button>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>E-Mail</Label>
                  <Input type="email" value={editState.shippingEmail} onChange={e => set("shippingEmail", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Telefon" : "Phone"}</Label>
                  <Input value={editState.shippingPhone} onChange={e => set("shippingPhone", e.target.value)} />
                </div>
              </div>
              <DialogFooter className="mt-4 shrink-0">
                <Button variant="outline" type="button" onClick={() => setEditState(null)}>{t("cancel", lang)}</Button>
                <Button type="submit" disabled={editSaving}>{t("save", lang)}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Legacy customer edit dialog */}
      <Dialog open={!!legacyEditState} onOpenChange={open => { if (!open) setLegacyEditState(null); }}>
        <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden max-w-xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {legacyEditState?.id === null
                ? (lang === "de" ? "Legacy-Kunde anlegen" : "Create Legacy Customer")
                : (lang === "de" ? "Legacy-Kunden bearbeiten" : "Edit Legacy Customer")}
            </DialogTitle>
          </DialogHeader>
          {legacyEditState && (
            <form onSubmit={handleLegacySave} className="space-y-4 pt-2 overflow-y-auto flex-1 pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="legacy-salutation">{lang === "de" ? "Anrede" : "Salutation"}</Label>
                  <select id="legacy-salutation" value={legacyEditState.salutation} onChange={e => setLegacy("salutation", e.target.value)} className={selectCls}>
                    <option value="">—</option>
                    <option value="Herr">{lang === "de" ? "Herr" : "Mr."}</option>
                    <option value="Frau">{lang === "de" ? "Frau" : "Mrs."}</option>
                    <option value="Divers">{lang === "de" ? "Divers" : "Diverse"}</option>
                    <option value="Andere">{lang === "de" ? "Andere" : "Other"}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="legacy-degree">{lang === "de" ? "Akad. Titel" : "Degree"}</Label>
                  <Input id="legacy-degree" value={legacyEditState.title} onChange={e => setLegacy("title", e.target.value)} placeholder="Dr., Prof., …" />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="legacy-name">{lang === "de" ? "Name" : "Name"} *</Label>
                  <Input id="legacy-name" value={legacyEditState.name} onChange={e => setLegacy("name", e.target.value)} required />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>{lang === "de" ? "Unternehmen / Institution" : "Company / Institution"}</Label>
                  <Input value={legacyEditState.company} onChange={e => setLegacy("company", e.target.value)} />
                </div>
              </div>

              <div className="border-t pt-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                  {lang === "de" ? "Adresse" : "Address"}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2 col-span-2">
                    <Label>{lang === "de" ? "Straße und Hausnummer" : "Address"}</Label>
                    <Input value={legacyEditState.address} onChange={e => setLegacy("address", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>PLZ</Label>
                    <Input value={legacyEditState.postalCode} onChange={e => setLegacy("postalCode", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{lang === "de" ? "Stadt" : "City"}</Label>
                    <Input value={legacyEditState.city} onChange={e => setLegacy("city", e.target.value)} />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>{t("country", lang)}</Label>
                    <Input value={legacyEditState.country} onChange={e => setLegacy("country", e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="border-t pt-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                  {lang === "de" ? "Kontakt" : "Contact"}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{lang === "de" ? "USt-IdNr." : "VAT ID"}</Label>
                    <Input value={legacyEditState.vatId} onChange={e => setLegacy("vatId", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("email", lang)}</Label>
                    <Input type="email" value={legacyEditState.email} onChange={e => setLegacy("email", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>{lang === "de" ? "Telefon" : "Phone"}</Label>
                    <Input value={legacyEditState.phone} onChange={e => setLegacy("phone", e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{lang === "de" ? "Notizen" : "Notes"}</Label>
                <textarea
                  value={legacyEditState.notes}
                  onChange={e => setLegacy("notes", e.target.value)}
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <DialogFooter className="mt-2 shrink-0">
                <Button variant="outline" type="button" onClick={() => setLegacyEditState(null)}>{t("cancel", lang)}</Button>
                <Button type="submit" disabled={legacyEditSaving}>
                  {legacyEditSaving ? (lang === "de" ? "Speichere…" : "Saving…") : t("save", lang)}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
