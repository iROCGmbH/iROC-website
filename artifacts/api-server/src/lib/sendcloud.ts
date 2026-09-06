import { logger } from "./logger";
import { SENDCLOUD_MAX_INSURED_VALUE } from "./shipment-rules";
import { normalizeCountryCode } from "@workspace/api-zod";

const BASE_URL = "https://panel.sendcloud.sc/api/v3";

export function normalizeSendcloudCountryCode(country: string): string {
  return normalizeCountryCode(country);
}

export type SendcloudOption = {
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

export type SendcloudCustomsItem = {
  description: string;
  quantity: number;
  value: number;
  hsCode: string;
  countryOfOrigin: string;
  sku: string;
  weightKg: number;
};

export type SendcloudCustomsInformation = {
  invoiceNumber: string;
  invoiceDate: string;
  exportReason: "commercial_goods" | "commercial_sample" | "gift" | "return_goods" | "documents" | "other";
  freightCosts: number;
  insuranceCosts: number;
};

export class SendcloudRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "SendcloudRequestError";
  }
}

function credentials(): { authorization: string } {
  const publicKey = process.env.SENDCLOUD_PUBLIC_KEY;
  const secretKey = process.env.SENDCLOUD_SECRET_KEY;
  if (!publicKey || !secretKey) throw new Error("Sendcloud is not configured");
  return { authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}` };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { authorization } = credentials();
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { Accept: "application/json", Authorization: authorization, ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    logger.warn({ status: response.status, path }, "Sendcloud request failed");
    throw new SendcloudRequestError(response.status, `Sendcloud request failed (${response.status}): ${details}`);
  }
  return await response.json() as T;
}

function moneyValue(value: unknown): number {
  if (typeof value === "object" && value !== null && "value" in value) {
    return Number((value as { value: unknown }).value);
  }
  return Number(value);
}

function sendcloudInsuredValue(value: number): number {
  // Sendcloud Shipment Protection accepts whole euros and rounds up.
  return Math.min(Math.ceil(value), SENDCLOUD_MAX_INSURED_VALUE);
}

function handoverFor(option: any): SendcloudOption["handover"] {
  const firstMile = option.functionalities?.first_mile;
  if (firstMile === "pickup" || firstMile === "dropoff" || firstMile === "pickup_dropoff") return firstMile;
  return option.functionalities?.pick_up ? "pickup" : "unknown";
}

/** Keep the rate picker practical: at most the cheapest pickup and drop-off option per carrier. */
export function selectPreferredSendcloudRates(rates: SendcloudOption[]): SendcloudOption[] {
  const byCarrier = new Map<string, SendcloudOption[]>();
  for (const rate of rates) {
    const key = rate.carrier.trim().toLocaleLowerCase("en-US");
    byCarrier.set(key, [...(byCarrier.get(key) ?? []), rate]);
  }
  const selected: SendcloudOption[] = [];
  for (const options of byCarrier.values()) {
    const sorted = [...options].sort((a, b) => a.totalPrice - b.totalPrice);
    const pickup = sorted.find((rate) => rate.handover === "pickup" || rate.handover === "pickup_dropoff");
    const dropoff = sorted.find((rate) => rate.handover === "dropoff");
    if (pickup) selected.push(pickup);
    if (dropoff && dropoff.id !== pickup?.id) selected.push(dropoff);
    if (!pickup && !dropoff) selected.push(...sorted.slice(0, 2));
  }
  return selected.sort((a, b) => a.totalPrice - b.totalPrice);
}

export async function getSendcloudRates(input: {
  country: string; postalCode: string; weightKg: number; lengthCm?: number; widthCm?: number; heightCm?: number;
  insuredValue?: number;
}): Promise<SendcloudOption[]> {
  const parcel: Record<string, unknown> = {
    weight: { value: String(input.weightKg), unit: "kg" },
  };
  if (input.lengthCm && input.widthCm && input.heightCm) {
    parcel.dimensions = {
      length: String(input.lengthCm), width: String(input.widthCm), height: String(input.heightCm), unit: "cm",
    };
  }
  if (input.insuredValue && input.insuredValue > 0) {
    // The live v3 endpoint validates this parcel field as an integer, not a
    // money object. Sending an object makes the entire rate lookup fail.
    parcel.total_insured_price = sendcloudInsuredValue(input.insuredValue);
  }
  const data = await request<{ data?: any[]; message?: string }>("/shipping-options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from_country_code: "DE",
      to_country_code: normalizeSendcloudCountryCode(input.country),
      to_postal_code: input.postalCode,
      parcels: [parcel],
      calculate_quotes: true,
    }),
  });
  const raw = data.data ?? [];
  const rates = raw.map((option: any): SendcloudOption | null => {
    const quote = option.quotes?.[0];
    const breakdown = quote?.price?.breakdown ?? [];
    const basePrice = moneyValue(breakdown.find((line: any) => line.type === "price_without_insurance")?.price);
    const insurancePrice = moneyValue(breakdown.find((line: any) => line.type === "insurance_price")?.price);
    const totalPrice = moneyValue(quote?.price?.total);
    const price = Number.isFinite(basePrice)
      ? basePrice
      : Math.max(0, (Number.isFinite(totalPrice) ? totalPrice : 0) - (Number.isFinite(insurancePrice) ? insurancePrice : 0));
    const id = option.code ?? option.shipping_option_code ?? option.id ?? option.service_point_id ?? option.service?.id;
    if (!id || !Number.isFinite(price)) return null;
    const handover = handoverFor(option);
    return {
      id: String(id),
      carrier: String(option.carrier?.name ?? option.carrier_code ?? option.carrier ?? "Carrier"),
      serviceCode: String(option.code ?? option.shipping_option_code ?? option.service?.code ?? option.id),
      name: String(option.name ?? option.shipping_option_name ?? option.service?.name ?? option.carrier?.name ?? option.code ?? "Shipping"),
      price,
      insurancePrice: Number.isFinite(insurancePrice) ? insurancePrice : 0,
      totalPrice: Number.isFinite(totalPrice) ? totalPrice : price + (Number.isFinite(insurancePrice) ? insurancePrice : 0),
      currency: String(quote?.price?.total?.currency ?? option.price?.currency ?? option.currency ?? "EUR"),
      pickupSupported: handover === "pickup" || handover === "pickup_dropoff",
      handover,
    };
  }).filter((rate): rate is SendcloudOption => rate !== null);
  return selectPreferredSendcloudRates(rates);
}

export async function createSendcloudShipment(input: {
  name: string; company?: string | null; address: string; houseNumber?: string | null; postalCode: string; city: string;
  country: string; email: string; phone?: string | null; weightKg: number; lengthCm?: number; widthCm?: number; heightCm?: number;
  serviceId: string; insuredValue: number; orderValue: number; externalReference?: string;
  customs?: {
    information: SendcloudCustomsInformation;
    items: SendcloudCustomsItem[];
  };
}): Promise<{ id: string; trackingNumber: string | null; labelUrl: string | null }> {
  const parcel: Record<string, unknown> = {
    weight: { value: String(input.weightKg), unit: "kg" },
  };
  if (input.lengthCm && input.widthCm && input.heightCm) {
    parcel.dimensions = {
      length: String(input.lengthCm), width: String(input.widthCm), height: String(input.heightCm), unit: "cm",
    };
  }
  if (input.insuredValue > 0) {
    parcel.total_insured_price = sendcloudInsuredValue(input.insuredValue);
  }
  const body: Record<string, unknown> = {
    label_details: { mime_type: "application/pdf", dpi: 72 },
    from_address: {
      name: "iROC GmbH", company_name: "iROC GmbH", address_line_1: "St.-Emmeram-Str.",
      house_number: "26", postal_code: "85609", city: "Aschheim", country_code: "DE", email: "info@i-roc.de",
    },
    to_address: {
      name: input.name, company_name: input.company ?? "", address_line_1: input.address, house_number: input.houseNumber ?? "",
      postal_code: input.postalCode, city: input.city, country_code: normalizeSendcloudCountryCode(input.country), phone_number: input.phone ?? "", email: input.email,
    },
    ship_with: { type: "shipping_option_code", properties: { shipping_option_code: input.serviceId } },
    order_number: input.externalReference,
    total_order_price: { value: input.orderValue.toFixed(2), currency: "EUR" },
    parcels: [parcel],
  };
  if (input.customs) {
    body.customs_information = {
      invoice_number: input.customs.information.invoiceNumber,
      invoice_date: input.customs.information.invoiceDate,
      export_reason: input.customs.information.exportReason,
      freight_costs: { value: input.customs.information.freightCosts.toFixed(2), currency: "EUR" },
      insurance_costs: { value: input.customs.information.insuranceCosts.toFixed(2), currency: "EUR" },
    };
    parcel.parcel_items = input.customs.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      price: { value: item.value.toFixed(2), currency: "EUR" },
      hs_code: item.hsCode,
      origin_country: normalizeSendcloudCountryCode(item.countryOfOrigin),
      sku: item.sku,
      weight: { value: item.weightKg.toFixed(3), unit: "kg" },
    }));
  }

  const data = await request<{ data?: any }>("/shipments/announce", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return shipmentResult(data.data);
}

/** Find a parcel submitted with our durable local shipment reference. */
export async function findSendcloudShipmentByExternalReference(externalReference: string): Promise<{
  id: string; trackingNumber: string | null; labelUrl: string | null;
} | null> {
  const query = new URLSearchParams({ order_number: externalReference });
  const data = await request<{ data?: any[] }>(`/shipments?${query}`);
  return data.data?.[0] ? shipmentResult(data.data[0]) : null;
}

function shipmentResult(shipment: any): { id: string; trackingNumber: string | null; labelUrl: string | null } {
  const parcel = shipment.parcels?.[0];
  const label = parcel?.documents?.find((document: any) => document.type === "label");
  return { id: String(shipment.id), trackingNumber: parcel?.tracking_number ?? null, labelUrl: label?.link ?? null };
}

export function nextPreferredPickupDate(from = new Date()): Date {
  const date = new Date(from);
  date.setHours(9, 0, 0, 0);
  for (let i = 0; i < 8; i++) {
    const day = date.getDay();
    if ([1, 3, 5].includes(day) && date > from) return date;
    date.setDate(date.getDate() + 1);
  }
  return date;
}