/** Supported currencies for purchase price entry */
export const PURCHASE_CURRENCIES = [
  "EUR", "USD", "CHF", "GBP", "JPY", "CNY", "SEK", "NOK", "DKK",
  "AUD", "CAD", "KRW", "SGD", "HKD", "PLN", "CZK",
] as const;

export type PurchaseCurrency = (typeof PURCHASE_CURRENCIES)[number];

export interface ConversionResult {
  eurAmount: number;
  /** The rate date actually used by frankfurter (may differ from requested date) */
  rateDate: string;
  /** e.g. 0.9230 — how many EUR one unit of fromCurrency is worth */
  rate: number;
}

/**
 * Convert `amount` in `fromCurrency` to EUR using the ECB rate for `date` (YYYY-MM-DD).
 *
 * If the ECB has not published rates for `date` yet (e.g. today before 16:00 CET,
 * weekends, public holidays) it automatically falls back to the latest available rate.
 *
 * Returns null on network error or unsupported currency pair.
 */
export async function convertToEUR(
  amount: number,
  fromCurrency: string,
  date: string,
): Promise<ConversionResult | null> {
  if (fromCurrency === "EUR") {
    return { eurAmount: amount, rateDate: date, rate: 1 };
  }
  if (!amount || amount <= 0) return null;

  const tryFetch = async (endpoint: string): Promise<ConversionResult | null> => {
    try {
      // Proxy through our own API server — the browser cannot reliably reach
      // api.frankfurter.app from Replit's proxied iframe environment.
      const params = new URLSearchParams({ from: fromCurrency, to: "EUR", amount: String(amount), date: endpoint });
      const res = await fetch(`/api/iroc/exchange-rate?${params}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data?.rates?.EUR !== "number") return null;
      return {
        eurAmount: data.rates.EUR,
        rateDate: data.date ?? endpoint,
        rate: data.rates.EUR / amount,
      };
    } catch {
      return null;
    }
  };

  // Try the requested date first; if it returns nothing, fall back to latest
  const result = await tryFetch(date);
  if (result) return result;
  return tryFetch("latest");
}
