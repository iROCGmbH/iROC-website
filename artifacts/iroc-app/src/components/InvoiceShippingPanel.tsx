import { useEffect, useState } from "react";
import { Package, Printer, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatMoney } from "@/lib/utils";
import { getGetIrocInvoiceQueryKey, type AppInvoiceFull } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type ShippingRate = {
  id: string;
  carrier: string;
  serviceCode: string;
  name: string;
  price: number;
  insurancePrice: number;
  totalPrice: number;
  currency: string;
  pickupSupported: boolean;
  handover: "pickup" | "dropoff" | "pickup_dropoff" | "unknown";
};

type InvoiceTotals = {
  deliveryCosts: string;
  insuranceCosts: string;
  vatAmount: string;
  total: string;
};

type PersistedShipment = {
  shipmentId: number;
  status: string;
  trackingNumber: string | null;
  labelUrl: string | null;
  sendcloudShipmentId?: string | null;
  deliveryCosts: string;
  insuranceCosts: string;
  insuredValue: string;
  pickupScheduledFor?: string | null;
  weightKg?: string;
  lengthCm?: string | null;
  widthCm?: string | null;
  heightCm?: string | null;
};

type ShipmentResult = PersistedShipment & { invoiceTotals: InvoiceTotals };

type ShippingRatesResponse = {
  rates: ShippingRate[];
  suggestedServiceId: string | null;
  insuredValue: number;
  uninsuredValue: number;
  pickupWindow: string;
  insuranceIncluded: boolean;
};

type InvoiceShippingPanelProps = {
  invoiceId: number;
  shipment?: PersistedShipment | null;
  invoiceTotals: InvoiceTotals;
  onInvoiceTotalsChanged: (totals: InvoiceTotals) => void;
};

export function InvoiceShippingPanel({
  invoiceId,
  shipment,
  invoiceTotals,
  onInvoiceTotalsChanged,
}: InvoiceShippingPanelProps) {
  const { toast } = useToast();
  const { lang } = useLanguage();
  const de = lang === "de";
  const queryClient = useQueryClient();
  const [parcelWeightKg, setParcelWeightKg] = useState("");
  const [parcelLengthCm, setParcelLengthCm] = useState("");
  const [parcelWidthCm, setParcelWidthCm] = useState("");
  const [parcelHeightCm, setParcelHeightCm] = useState("");
  const [shippingRates, setShippingRates] = useState<ShippingRate[]>([]);
  const [selectedShippingRateId, setSelectedShippingRateId] = useState("");
  const [shipmentInsuredValue, setShipmentInsuredValue] = useState(0);
  const [shipmentUninsuredValue, setShipmentUninsuredValue] = useState(0);
  const [includeInsurance, setIncludeInsurance] = useState(true);
  const [pickupWindow, setPickupWindow] = useState("");
  const [loadingShippingRates, setLoadingShippingRates] = useState(false);
  const [creatingShipment, setCreatingShipment] = useState(false);
  const [shipmentConfirmed, setShipmentConfirmed] = useState(false);
  const [shipmentResult, setShipmentResult] = useState<ShipmentResult | null>(null);

  const selectedShippingRate = shippingRates.find((rate) => rate.id === selectedShippingRateId) ?? null;
  const hasCreatedShipment = shipmentResult?.status === "created";
  const shipmentNeedsReconciliation = shipmentResult?.status === "needs_reconciliation";

  useEffect(() => {
    if (shipment) {
      setShipmentResult({ ...shipment, invoiceTotals });
      setParcelWeightKg(shipment.weightKg ?? "");
      setParcelLengthCm(shipment.lengthCm ?? "");
      setParcelWidthCm(shipment.widthCm ?? "");
      setParcelHeightCm(shipment.heightCm ?? "");
    } else {
      setShipmentResult(null);
    }
  // The parent creates its totals object during render; only hydrate a persisted
  // shipment when the shipment itself changes, otherwise this would re-render forever.
  // The freshly-created result below already carries the latest returned totals.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipment]);

  const fetchShippingRates = async () => {
    const weight = Number(parcelWeightKg);
    if (!Number.isFinite(weight) || weight <= 0) {
      toast({ title: "Parcel weight is required", description: "Enter a positive parcel weight before retrieving rates.", variant: "destructive" });
      return;
    }

    const params = new URLSearchParams({
      weightKg: String(weight),
      includeInsurance: String(includeInsurance),
    });
    if (Number(parcelLengthCm) > 0) params.set("lengthCm", parcelLengthCm);
    if (Number(parcelWidthCm) > 0) params.set("widthCm", parcelWidthCm);
    if (Number(parcelHeightCm) > 0) params.set("heightCm", parcelHeightCm);
    const token = localStorage.getItem("iroc_token");

    setLoadingShippingRates(true);
    setShipmentConfirmed(false);
    try {
      const response = await fetch(`/api/iroc/invoices/${invoiceId}/shipping-rates?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const payload = await response.json() as ShippingRatesResponse | { error?: string };
      if (!response.ok) throw new Error("error" in payload ? payload.error : "Unable to retrieve shipping rates");

      const data = payload as ShippingRatesResponse;
      setShippingRates(data.rates);
      setSelectedShippingRateId(data.suggestedServiceId ?? data.rates[0]?.id ?? "");
      setShipmentInsuredValue(data.insuredValue);
      setShipmentUninsuredValue(data.uninsuredValue);
      setPickupWindow(data.pickupWindow);
      if (!data.rates.length) {
        toast({ title: "No shipping rates", description: "Sendcloud did not return an eligible shipping option for this parcel." });
      }
    } catch (error) {
      setShippingRates([]);
      setSelectedShippingRateId("");
      toast({ title: "Unable to load shipping rates", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setLoadingShippingRates(false);
    }
  };

  const createShipment = async () => {
    if (!selectedShippingRate) return;

    const token = localStorage.getItem("iroc_token");
    setCreatingShipment(true);
    try {
      const response = await fetch(`/api/iroc/invoices/${invoiceId}/shipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          serviceId: selectedShippingRate.id,
          carrier: selectedShippingRate.carrier,
          serviceCode: selectedShippingRate.serviceCode,
          quotedDeliveryCost: selectedShippingRate.price,
          quotedInsuranceCost: includeInsurance ? selectedShippingRate.insurancePrice : 0,
          includeInsurance,
          weightKg: Number(parcelWeightKg),
          lengthCm: parcelLengthCm ? Number(parcelLengthCm) : undefined,
          widthCm: parcelWidthCm ? Number(parcelWidthCm) : undefined,
          heightCm: parcelHeightCm ? Number(parcelHeightCm) : undefined,
          confirm: shipmentConfirmed,
        }),
      });
      const payload = await response.json() as {
        shipmentId: number;
        trackingNumber: string | null;
        labelUrl: string | null;
        insuredValue: number;
        insuranceCosts: number;
        pickupScheduledFor: string;
        invoiceTotals?: InvoiceTotals;
        error?: string;
      };
      if (payload.invoiceTotals) {
        onInvoiceTotalsChanged(payload.invoiceTotals);
        queryClient.setQueryData<AppInvoiceFull>(
          getGetIrocInvoiceQueryKey(invoiceId),
          (current) => current ? { ...current, ...payload.invoiceTotals } : current,
        );
        await queryClient.invalidateQueries({ queryKey: getGetIrocInvoiceQueryKey(invoiceId) });
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to create shipment");
      if (!payload.invoiceTotals) throw new Error("Shipment response did not include updated invoice totals");

      const createdShipment: ShipmentResult = {
        shipmentId: payload.shipmentId,
        status: "created",
        trackingNumber: payload.trackingNumber,
        labelUrl: payload.labelUrl,
        insuredValue: String(payload.insuredValue),
        insuranceCosts: String(payload.insuranceCosts),
        pickupScheduledFor: payload.pickupScheduledFor,
        deliveryCosts: payload.invoiceTotals.deliveryCosts,
        invoiceTotals: payload.invoiceTotals,
      };
      setShipmentResult(createdShipment);
      queryClient.setQueryData<AppInvoiceFull>(
        getGetIrocInvoiceQueryKey(invoiceId),
        (current) => current
          ? { ...current, ...payload.invoiceTotals, shipment: createdShipment }
          : current,
      );
      await queryClient.invalidateQueries({ queryKey: getGetIrocInvoiceQueryKey(invoiceId) });
      toast({ title: "Shipment created", description: payload.trackingNumber ?? "Shipment accepted by Sendcloud" });
    } catch (error) {
      toast({ title: "Shipment could not be created", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setCreatingShipment(false);
    }
  };

  const printShippingLabel = () => {
    if (!shipmentResult?.labelUrl) {
      toast({ title: "Shipping label unavailable", description: "Sendcloud has not returned a printable label.", variant: "destructive" });
      return;
    }
    if (!window.open(shipmentResult.labelUrl, "_blank", "noopener,noreferrer")) {
      toast({ title: "Label window blocked", description: "Allow pop-ups to open and print the shipping label.", variant: "destructive" });
    }
  };

  return (
    <Card className="border-sky-200 dark:border-sky-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-sky-600" />
          Sendcloud shipping
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Enter parcel data, retrieve a rate, and explicitly confirm the paid shipment. For non-EU destinations, save complete commercial-invoice customs data first.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasCreatedShipment && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor={`parcel-weight-${invoiceId}`}>Weight (kg) *</Label>
                <Input id={`parcel-weight-${invoiceId}`} type="number" min="0.001" step="0.001" value={parcelWeightKg} onChange={(event) => setParcelWeightKg(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`parcel-length-${invoiceId}`}>Length (cm)</Label>
                <Input id={`parcel-length-${invoiceId}`} type="number" min="0.1" step="0.1" value={parcelLengthCm} onChange={(event) => setParcelLengthCm(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`parcel-width-${invoiceId}`}>Width (cm)</Label>
                <Input id={`parcel-width-${invoiceId}`} type="number" min="0.1" step="0.1" value={parcelWidthCm} onChange={(event) => setParcelWidthCm(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`parcel-height-${invoiceId}`}>Height (cm)</Label>
                <Input id={`parcel-height-${invoiceId}`} type="number" min="0.1" step="0.1" value={parcelHeightCm} onChange={(event) => setParcelHeightCm(event.target.value)} />
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{de ? "Versandversicherung" : "Shipping insurance"}</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name={`insurance-${invoiceId}`}
                    checked={includeInsurance}
                    onChange={() => { setIncludeInsurance(true); setShippingRates([]); setSelectedShippingRateId(""); }}
                  />
                  {de ? "Versicherung einschließen" : "Include insurance"}
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name={`insurance-${invoiceId}`}
                    checked={!includeInsurance}
                    onChange={() => { setIncludeInsurance(false); setShippingRates([]); setSelectedShippingRateId(""); }}
                  />
                  {de ? "Ohne Versicherung" : "Exclude insurance"}
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {includeInsurance
                  ? (de ? "Die Sendcloud-Versicherungsgebühr wird in die Versandkosten aufgenommen." : "The Sendcloud insurance fee will be included in the shipping costs.")
                  : (de ? "Keine Sendcloud-Versicherung wird angefordert oder berechnet." : "No Sendcloud insurance will be requested or charged.")}
              </p>
            </fieldset>
            <Button type="button" variant="outline" onClick={fetchShippingRates} disabled={loadingShippingRates || creatingShipment || shipmentNeedsReconciliation}>
              <Truck className="mr-2 h-4 w-4" />
              {loadingShippingRates ? "Loading shipping rates…" : "Load shipping rates"}
            </Button>
          </>
        )}

        {shippingRates.length > 0 && !hasCreatedShipment && (
          <div className="space-y-2">
            <Label>Choose a shipping rate</Label>
            <div className="grid gap-2">
              {shippingRates.map((rate) => (
                <div key={rate.id} className={`flex items-center justify-between gap-3 rounded-md border p-3 ${selectedShippingRateId === rate.id ? "border-sky-500 bg-sky-50 dark:bg-sky-950/30" : "border-border"}`}>
                  <span className="flex items-center gap-3">
                    <input type="radio" name={`shipping-rate-${invoiceId}`} aria-label={`${rate.carrier} · ${rate.name}`} checked={selectedShippingRateId === rate.id} onChange={() => { setSelectedShippingRateId(rate.id); setShipmentConfirmed(false); }} />
                    <span>
                      <span className="block font-medium">{rate.carrier} · {rate.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {rate.serviceCode} · {rate.handover === "pickup" ? "Pickup" : rate.handover === "dropoff" ? "Drop-off" : rate.handover === "pickup_dropoff" ? "Pickup or drop-off" : "Handover not specified"}
                        {rate.pickupSupported ? ` · ${pickupWindow}` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-right">
                      <span className="block font-semibold">{formatMoney(rate.totalPrice)} {rate.currency !== "EUR" ? rate.currency : ""}</span>
                      <span className="block text-xs text-muted-foreground">
                        Shipping {formatMoney(rate.price)}{rate.insurancePrice > 0 ? ` + insurance ${formatMoney(rate.insurancePrice)}` : ""}
                      </span>
                    </span>
                    <Button type="button" size="sm" variant={selectedShippingRateId === rate.id ? "secondary" : "outline"} onClick={() => { setSelectedShippingRateId(rate.id); setShipmentConfirmed(false); }}>
                      {selectedShippingRateId === rate.id ? "Selected" : "Use rate"}
                    </Button>
                  </span>
                </div>
              ))}
            </div>
            {includeInsurance && shipmentInsuredValue > 0 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                {shipmentUninsuredValue > 0
                  ? `Sendcloud can insure up to ${formatMoney(shipmentInsuredValue)} per shipment. ${formatMoney(shipmentUninsuredValue)} of this invoice value requires separate cover.`
                  : `Full insurance will be requested for the invoice value of ${formatMoney(shipmentInsuredValue)}.`}
                {selectedShippingRate && selectedShippingRate.insurancePrice > 0
                  ? ` ${de ? "Versicherungsgebühr" : "Insurance fee"}: ${formatMoney(selectedShippingRate.insurancePrice)}.`
                  : (de ? "Der Tarif enthält keine separate Versicherungsgebühr." : "The rate does not list a separate insurance fee.")}
              </p>
            )}
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={shipmentConfirmed} onChange={(event) => setShipmentConfirmed(event.target.checked)} />
              <span>{selectedShippingRate
                ? `${de ? "Ich bestätige die kostenpflichtige Sendung über" : "I confirm the paid shipment at"} ${formatMoney(selectedShippingRate.totalPrice)}; ${includeInsurance ? (de ? "Versand- und Versicherungskosten" : "shipping and insurance costs") : (de ? "Versandkosten ohne Versicherung" : "shipping costs without insurance")} ${de ? "werden zur Entwurfsrechnung hinzugefügt." : "will be added to the draft invoice."}`
                : (de ? "Kostenpflichtige Sendung vor dem Erstellen bestätigen." : "Confirm the paid shipment before creating it.")}</span>
            </label>
            <Button type="button" onClick={createShipment} disabled={!selectedShippingRate || !shipmentConfirmed || creatingShipment || shipmentNeedsReconciliation}>
              <Package className="mr-2 h-4 w-4" />
              {creatingShipment ? "Creating shipment…" : "Create confirmed shipment"}
            </Button>
          </div>
        )}

        {shipmentResult?.status === "provider_error" && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            Sendcloud rejected the previous shipment. The confirmed invoice charges remain saved. Review the provider issue, then retrieve a rate and explicitly try again.
          </div>
        )}

        {shipmentNeedsReconciliation && (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Sendcloud did not confirm the previous request. This shipment needs reconciliation and cannot be submitted again.
          </div>
        )}

        {shipmentResult && hasCreatedShipment && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
            <p className="font-semibold">Shipment created</p>
            {shipmentResult.trackingNumber && <p>Tracking number: {shipmentResult.trackingNumber}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={printShippingLabel} disabled={!shipmentResult.labelUrl}>
                <Printer className="mr-2 h-4 w-4" />
                Print shipping label
              </Button>
              {shipmentResult.labelUrl && <a className="underline" href={shipmentResult.labelUrl} target="_blank" rel="noreferrer">Open label PDF</a>}
            </div>
            <p className="mt-2 text-xs">The label opens in a separate window for printing.</p>
            {!shipmentResult.labelUrl && <p className="mt-2 text-amber-800">Sendcloud has not returned a printable label.</p>}
            <p className="mt-2 font-medium">
              Invoice totals updated — shipping: {formatMoney(shipmentResult.invoiceTotals.deliveryCosts)}
              {" · "}insurance: {formatMoney(shipmentResult.invoiceTotals.insuranceCosts)}
              {" · "}VAT: {formatMoney(shipmentResult.invoiceTotals.vatAmount)}
              {" · "}total: {formatMoney(shipmentResult.invoiceTotals.total)}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}