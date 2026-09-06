import { afterEach, describe, expect, it, vi } from "vitest";
import { createSendcloudShipment, getSendcloudRates, nextPreferredPickupDate, selectPreferredSendcloudRates } from "./sendcloud";

afterEach(() => {
  delete process.env.SENDCLOUD_PUBLIC_KEY;
  delete process.env.SENDCLOUD_SECRET_KEY;
  vi.unstubAllGlobals();
});

describe("Sendcloud client", () => {
  it("passes parcel dimensions through rate lookup and preserves an insurance quote", async () => {
    process.env.SENDCLOUD_PUBLIC_KEY = "public";
    process.env.SENDCLOUD_SECRET_KEY = "secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{
        code: "dhl:parcel",
        carrier: { code: "dhl", name: "DHL" },
        name: "DHL Parcel",
        functionalities: { first_mile: "pickup_dropoff" },
        quotes: [{
          price: {
            breakdown: [
              { type: "price_without_insurance", price: { value: "12.50", currency: "EUR" } },
              { type: "insurance_price", price: { value: "4.90", currency: "EUR" } },
            ],
            total: { value: "17.40", currency: "EUR" },
          },
        }],
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const rates = await getSendcloudRates({
      country: "DE", postalCode: "10115", weightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10,
    });

    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.parcels[0]).toMatchObject({
      weight: { value: "2", unit: "kg" },
      dimensions: { length: "30", width: "20", height: "10", unit: "cm" },
    });
    expect(rates[0]).toMatchObject({
      id: "dhl:parcel", carrier: "DHL", price: 12.5, insurancePrice: 4.9, totalPrice: 17.4,
      pickupSupported: true, handover: "pickup_dropoff",
    });
  });

  it("normalizes the customer country name for Sendcloud", async () => {
    process.env.SENDCLOUD_PUBLIC_KEY = "public";
    process.env.SENDCLOUD_SECRET_KEY = "secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await getSendcloudRates({ country: "Deutschland", postalCode: "10115", weightKg: 1 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to_country_code).toBe("DE");
  });

  it("uses the shared ISO normalizer for EU country names in rates and shipment payloads", async () => {
    process.env.SENDCLOUD_PUBLIC_KEY = "public";
    process.env.SENDCLOUD_SECRET_KEY = "secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { id: "shipment-hr", parcels: [] },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await getSendcloudRates({ country: "Croatia", postalCode: "10000", weightKg: 1 });
    await createSendcloudShipment({
      name: "Test", address: "Street", postalCode: "10000", city: "Zagreb", country: "Croatia", email: "test@example.com",
      weightKg: 1, serviceId: "service-1", insuredValue: 0, orderValue: 100,
    });

    const rateBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const shipmentBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(rateBody.to_country_code).toBe("HR");
    expect(shipmentBody.to_address.country_code).toBe("HR");
  });

  it.each([
    ["German", "DE", "10115"],
    ["EU", "AT", "1010"],
    ["non-EU", "CH", "8001"],
  ])("uses mocked rate and parcel responses for a %s destination", async (_label, country, postalCode) => {
    process.env.SENDCLOUD_PUBLIC_KEY = "public";
    process.env.SENDCLOUD_SECRET_KEY = "secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          code: `dhl:${country.toLowerCase()}`,
          carrier: { name: "DHL" },
          name: `DHL ${country}`,
          functionalities: { first_mile: country === "DE" ? "pickup_dropoff" : "dropoff" },
          quotes: [{
            price: {
              breakdown: [
                { type: "price_without_insurance", price: { value: "12.50", currency: "EUR" } },
                { type: "insurance_price", price: { value: "4.90", currency: "EUR" } },
              ],
              total: { value: "17.40", currency: "EUR" },
            },
          }],
        }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          id: `shipment-${country.toLowerCase()}`,
          parcels: [{ tracking_number: `TRACK-${country}`, documents: [{ type: "label", link: `https://labels.example/${country}.pdf` }] }],
        },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const rates = await getSendcloudRates({ country, postalCode, weightKg: 2, insuredValue: 1000.01 });
    const parcel = await createSendcloudShipment({
      name: "Ada Lovelace", address: "Example Street", houseNumber: "12", postalCode, city: "Example City",
      country, email: "ada@example.com", weightKg: 2, serviceId: rates[0].id, insuredValue: 1000.01,
      orderValue: 1000.01, externalReference: `test-${country}`,
    });

    const rateBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const parcelBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(rateBody).toMatchObject({
      to_country_code: country,
      to_postal_code: postalCode,
      parcels: [{ total_insured_price: 1001 }],
    });
    expect(parcelBody).toMatchObject({
      order_number: `test-${country}`,
      to_address: { country_code: country, postal_code: postalCode },
      parcels: [{ total_insured_price: 1001 }],
    });
    expect(rates[0]).toMatchObject({
      id: `dhl:${country.toLowerCase()}`,
      totalPrice: 17.4,
      pickupSupported: country === "DE",
    });
    expect(parcel).toMatchObject({ id: `shipment-${country.toLowerCase()}`, trackingNumber: `TRACK-${country}` });
  });

  it("rounds decimal insured values up to whole euros for rate lookup", async () => {
    process.env.SENDCLOUD_PUBLIC_KEY = "public";
    process.env.SENDCLOUD_SECRET_KEY = "secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await getSendcloudRates({
      country: "DE", postalCode: "10115", weightKg: 1, insuredValue: 1000.01,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.parcels[0].total_insured_price).toBe(1001);
  });

  it("omits insurance from Sendcloud quote and shipment payloads when excluded", async () => {
    process.env.SENDCLOUD_PUBLIC_KEY = "public";
    process.env.SENDCLOUD_SECRET_KEY = "secret";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          id: "shipment-uninsured",
          parcels: [{ tracking_number: "TRACK-UNINSURED", documents: [] }],
        },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await getSendcloudRates({ country: "DE", postalCode: "10115", weightKg: 1, insuredValue: 0 });
    await createSendcloudShipment({
      name: "Test", address: "Street", postalCode: "10115", city: "Berlin", country: "DE", email: "test@example.com",
      weightKg: 1, serviceId: "service-1", insuredValue: 0, orderValue: 100,
    });

    const quoteBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const shipmentBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(quoteBody.parcels[0]).not.toHaveProperty("total_insured_price");
    expect(shipmentBody.parcels[0]).not.toHaveProperty("total_insured_price");
  });

  it("caps the insured value at Sendcloud's €5,000 protection limit", async () => {
    process.env.SENDCLOUD_PUBLIC_KEY = "public";
    process.env.SENDCLOUD_SECRET_KEY = "secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await getSendcloudRates({
      country: "AT", postalCode: "1010", weightKg: 1, insuredValue: 12551.07,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.parcels[0].total_insured_price).toBe(5000);
  });

  it("surfaces a provider failure instead of silently creating a shipment", async () => {
    process.env.SENDCLOUD_PUBLIC_KEY = "public";
    process.env.SENDCLOUD_SECRET_KEY = "secret";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("carrier unavailable", { status: 503 })));

    await expect(createSendcloudShipment({
      name: "Test", address: "Street", postalCode: "10115", city: "Berlin", country: "DE", email: "test@example.com",
      weightKg: 1, serviceId: "service-1", insuredValue: 0, orderValue: 100,
    })).rejects.toThrow("Sendcloud request failed (503)");
  });

  it("sends a durable external reference when creating a parcel", async () => {
    process.env.SENDCLOUD_PUBLIC_KEY = "public";
    process.env.SENDCLOUD_SECRET_KEY = "secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        id: "shipment-123",
        parcels: [{ tracking_number: "TRACK-123", documents: [{ type: "label", link: "https://example.com/label.pdf" }] }],
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createSendcloudShipment({
      name: "Test", address: "Street", postalCode: "10115", city: "Berlin", country: "DE", email: "test@example.com",
      weightKg: 1, serviceId: "service-1", insuredValue: 0, orderValue: 100, externalReference: "iroc-invoice-shipment:99",
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/shipments/announce");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.order_number).toBe("iroc-invoice-shipment:99");
    expect(body.ship_with.properties.shipping_option_code).toBe("service-1");
    expect(body.to_address).toMatchObject({ name: "Test", postal_code: "10115", country_code: "DE" });
  });

  it("includes validated commercial-invoice customs data without logging or exposing credentials", async () => {
    process.env.SENDCLOUD_PUBLIC_KEY = "public";
    process.env.SENDCLOUD_SECRET_KEY = "secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { id: "shipment-customs", parcels: [{}] },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createSendcloudShipment({
      name: "Ada Lovelace", address: "Example Street", postalCode: "10001", city: "New York", country: "US",
      email: "ada@example.com", weightKg: 2, serviceId: "service-1", insuredValue: 0, orderValue: 250,
      customs: {
        information: {
          invoiceNumber: "2026-0010", invoiceDate: "2026-08-24", exportReason: "commercial_goods",
          freightCosts: 12.5, insuranceCosts: 3.6,
        },
        items: [{
          description: "Medical instrument", quantity: 2, value: 125, hsCode: "901890",
          countryOfOrigin: "DE", sku: "IROC-001", weightKg: 0.75,
        }],
      },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.customs_information).toEqual({
      invoice_number: "2026-0010", invoice_date: "2026-08-24", export_reason: "commercial_goods",
      freight_costs: { value: "12.50", currency: "EUR" }, insurance_costs: { value: "3.60", currency: "EUR" },
    });
    expect(body.parcels[0].parcel_items).toEqual([{
      description: "Medical instrument", quantity: 2, price: { value: "125.00", currency: "EUR" },
      hs_code: "901890", origin_country: "DE", sku: "IROC-001", weight: { value: "0.750", unit: "kg" },
    }]);
  });

  it("rounds decimal insured values up when creating a parcel", async () => {
    process.env.SENDCLOUD_PUBLIC_KEY = "public";
    process.env.SENDCLOUD_SECRET_KEY = "secret";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { id: "shipment-124", parcels: [{}] },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createSendcloudShipment({
      name: "Test", address: "Street", postalCode: "10115", city: "Berlin", country: "DE", email: "test@example.com",
      weightKg: 1, serviceId: "service-1", insuredValue: 1000.01, orderValue: 1000.01,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.parcels[0].total_insured_price).toBe(1001);
  });

  it("keeps only the cheapest pickup and drop-off rate per carrier", () => {
    const rate = (id: string, carrier: string, handover: "pickup" | "dropoff", totalPrice: number) => ({
      id, carrier, serviceCode: id, name: id, price: totalPrice, insurancePrice: 0, totalPrice, currency: "EUR",
      pickupSupported: handover === "pickup", handover,
    });
    const rates = selectPreferredSendcloudRates([
      rate("dhl-pickup-expensive", "DHL", "pickup", 15),
      rate("dhl-pickup-cheap", "DHL", "pickup", 10),
      rate("dhl-dropoff-cheap", "DHL", "dropoff", 8),
      rate("dhl-dropoff-expensive", "DHL", "dropoff", 12),
      rate("dpd-dropoff", "DPD", "dropoff", 7),
    ]);

    expect(rates.map((item) => item.id)).toEqual(["dpd-dropoff", "dhl-dropoff-cheap", "dhl-pickup-cheap"]);
  });

  it("schedules pickup at 09:00 on the next preferred Monday, Wednesday, or Friday", () => {
    const sameMonday = nextPreferredPickupDate(new Date(2026, 7, 24, 8, 0, 0));
    const nextWednesday = nextPreferredPickupDate(new Date(2026, 7, 24, 14, 0, 0));

    expect([sameMonday.getDay(), sameMonday.getHours(), sameMonday.getMinutes()]).toEqual([1, 9, 0]);
    expect([nextWednesday.getDay(), nextWednesday.getHours(), nextWednesday.getMinutes()]).toEqual([3, 9, 0]);
  });
});