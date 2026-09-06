import { useState, useEffect, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";
import { formatDate, formatMoney } from "@/lib/utils";
import { adminGet, adminDelete } from "@/lib/admin-fetch";
import { type AppInvoice, useListIrocInvoices } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Mail, Phone, MapPin, Building2, Trash2, Globe, Stethoscope, Eye } from "lucide-react";
import { Link } from "wouter";

const EU_COUNTRIES = new Set(["AT","BE","BG","CY","CZ","DK","EE","FI","FR","GR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK"]);

interface WebsiteCustomer {
  id: number;
  customerNr: string | null;
  firstName: string | null;
  lastName: string | null;
  institutionName: string | null;
  institutionType: string | null;
  specialty: string | null;
  email: string;
  phone: string | null;
  fax: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
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
  legacyCustomerId?: number | null;
  createdAt: string;
}

const INSTRUMENT_LABELS: Record<string, string> = {
  spirecut: "Spirecut®", ministem: "MiniStem®", both: "Both",
  other: "Other", post_training_support: "Post-Training Support", practice_marketing_support: "Practice Marketing",
};

function customerCertifications(customer: Pick<WebsiteCustomer, "certifications" | "instrument">): string[] {
  if (customer.certifications && customer.certifications.length > 0) return customer.certifications;
  return customer.instrument === "both"
    ? ["spirecut", "ministem"]
    : customer.instrument.split(",").map((value) => value.trim()).filter(Boolean);
}

export function filterCustomerInvoices<T extends Pick<AppInvoice, "websiteCustomerId" | "customerId">>(
  invoices: readonly T[] | undefined,
  websiteCustomerId: number,
  legacyCustomerId: number | null | undefined,
): T[] {
  return invoices?.filter(
    invoice =>
      invoice.websiteCustomerId === websiteCustomerId ||
      (
        invoice.websiteCustomerId == null &&
        legacyCustomerId != null &&
        invoice.customerId === legacyCustomerId
      ),
  ) ?? [];
}

export default function CustomerDetail() {
  const { id } = useParams();
  const customerId = parseInt(id || "0", 10);
  const { lang } = useLanguage();
  const { token } = useAuth();
  const [, setLocation] = useLocation();

  const [customer, setCustomer] = useState<WebsiteCustomer | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const { data: allInvoices } = useListIrocInvoices();
  const customerInvoices = filterCustomerInvoices(allInvoices, customerId, customer?.legacyCustomerId);

  const { data: categoryTotals } = useQuery<{ category: string; total: string }[]>({
    queryKey: ["customer-category-totals", customerId, customer?.legacyCustomerId],
    enabled: !!token && !!customerId && !loading,
    queryFn: async () => {
      const res = await fetch(`/api/iroc/website-customers/${customerId}/category-totals`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    adminGet<WebsiteCustomer>(`/api/iroc/website-customers/${customerId}`, token)
      .then(data => setCustomer(data))
      .catch(() => setCustomer(null))
      .finally(() => setLoading(false));
  }, [customerId, token]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (!token || !confirm("Delete this customer? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await adminDelete(`/api/iroc/website-customers/${customerId}`, token);
      setLocation("/customers");
    } catch {
      alert("Failed to delete customer");
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-[400px]" /></div>;
  }
  if (!customer) return <div className="text-muted-foreground p-8">{lang === "de" ? "Kunde nicht gefunden" : "Customer not found"}</div>;

  const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.email;
  const isEu = EU_COUNTRIES.has((customer.country ?? "").toUpperCase());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/customers"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{fullName}</h1>
            <div className="flex items-center gap-2 mt-1">
              {customer.customerNr && (
                <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">{customer.customerNr}</span>
              )}
              {isEu && <Badge variant="secondary" className="text-[10px]">EU</Badge>}
              {customerCertifications(customer).map((certification) => (
                <Badge key={certification} variant="outline" className="text-[10px]">
                  {INSTRUMENT_LABELS[certification] ?? certification}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
          <Trash2 className="h-4 w-4 mr-2" />{t("delete", lang)}
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>{lang === "de" ? "Kontaktinformationen" : "Contact Information"}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {customer.institutionName && (
              <div className="flex items-center gap-3 text-sm">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <div className="font-medium">{customer.institutionName}</div>
                  {customer.institutionType && <div className="text-xs text-muted-foreground">{customer.institutionType}</div>}
                </div>
              </div>
            )}
            {customer.specialty && (
              <div className="flex items-center gap-3 text-sm">
                <Stethoscope className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>{customer.specialty}</span>
              </div>
            )}
            <div className="flex items-center gap-3 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <a href={`mailto:${customer.email}`} className="text-primary hover:underline">{customer.email}</a>
            </div>
            {customer.phone && (
              <div className="flex items-center gap-3 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>{customer.phone}</span>
              </div>
            )}
            {(customer.address || customer.city) && (
              <div className="flex items-start gap-3 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground font-medium mb-0.5">{lang === "de" ? "Rechnungsadresse" : "Billing Address"}</p>
                  {customer.address && <p>{customer.address}</p>}
                  <p>{[customer.postalCode, customer.city].filter(Boolean).join(" ")}</p>
                  {customer.country && <p className="font-medium">{customer.country}</p>}
                </div>
              </div>
            )}
            {(customer.shippingFirstName || customer.shippingAddress) && (
              <div className="flex items-start gap-3 text-sm">
                <MapPin className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-blue-600 font-medium mb-0.5">{lang === "de" ? "Lieferadresse" : "Shipping Address"}</p>
                  {[customer.shippingFirstName, customer.shippingLastName].filter(Boolean).join(" ") && (
                    <p className="font-medium">{[customer.shippingFirstName, customer.shippingLastName].filter(Boolean).join(" ")}</p>
                  )}
                  {customer.shippingInstitutionName && <p>{customer.shippingInstitutionName}</p>}
                  {customer.shippingAddress && <p>{customer.shippingAddress}</p>}
                  <p>{[customer.shippingPostalCode, customer.shippingCity].filter(Boolean).join(" ")}</p>
                  {customer.shippingCountry && <p className="font-medium">{customer.shippingCountry}</p>}
                  {customer.shippingEmail && <p className="text-xs text-muted-foreground">{customer.shippingEmail}</p>}
                  {customer.shippingPhone && <p className="text-xs text-muted-foreground">{customer.shippingPhone}</p>}
                </div>
              </div>
            )}
            {customer.website && (
              <div className="flex items-center gap-3 text-sm">
                <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                <a href={customer.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">{customer.website}</a>
              </div>
            )}
            {customer.ustIdNr && (
              <div className="flex gap-2 text-sm pt-3 border-t">
                <span className="text-muted-foreground">{t("vat_id", lang)}:</span>
                <span className="font-mono">{customer.ustIdNr}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("notes", lang)}</CardTitle></CardHeader>
          <CardContent>
            {customer.notes
              ? <p className="text-sm whitespace-pre-wrap">{customer.notes}</p>
              : <p className="text-sm text-muted-foreground italic">{lang === "de" ? "Keine Notizen" : "No notes"}</p>}
          </CardContent>
        </Card>
      </div>

      {categoryTotals && categoryTotals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{lang === "de" ? "Umsatz nach Kategorie" : "Revenue by Category"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {categoryTotals.map(ct => (
                <div key={ct.category} className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">
                    {ct.category === "spirecut"
                      ? "Spirecut®"
                      : ct.category === "ministem"
                        ? "MiniStem®"
                        : ct.category === "services"
                          ? t("services", lang)
                          : ct.category === "other"
                            ? (lang === "de" ? "Sonstige" : "Other")
                            : ct.category}
                  </span>
                  <span className="text-sm font-semibold">{formatMoney(ct.total)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <h2 className="text-2xl font-bold tracking-tight mt-8 mb-4">{t("invoices", lang)}</h2>
      <div className="border rounded-md bg-card">
        <div className="overflow-y-auto max-h-[60vh] sticky-header-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("invoice_number", lang)}</TableHead>
              <TableHead>{t("issue_date", lang)}</TableHead>
              <TableHead>{t("status", lang)}</TableHead>
              <TableHead className="text-right">{t("total", lang)}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customerInvoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  {lang === "de" ? "Keine Rechnungen für diesen Kunden" : "No invoices for this customer"}
                </TableCell>
              </TableRow>
            ) : (
              customerInvoices.map(inv => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium font-mono text-sm">
                    <Link href={`/invoices/${inv.id}`} className="hover:underline">{inv.invoiceNumber}</Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(inv.issueDate)}</TableCell>
                  <TableCell>
                    <Badge variant={inv.status === "paid" ? "success" : inv.status === "sent" ? "default" : inv.status === "cancelled" ? "destructive" : "secondary"}
                      className={inv.status === "cancelled" ? "opacity-75" : ""}>
                      {t(inv.status, lang)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatMoney(inv.total)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="View">
                      <Link href={`/invoices/${inv.id}`}><Eye className="h-4 w-4" /></Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </div>
    </div>
  );
}
