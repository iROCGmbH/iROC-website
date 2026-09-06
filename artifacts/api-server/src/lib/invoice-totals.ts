export function calculateInvoiceTotals(input: {
  subtotal: number;
  deliveryCosts: number;
  insuranceCosts: number;
  vatRate: number;
}): { vatAmount: number; total: number } {
  const taxableAmount = input.subtotal + input.deliveryCosts + input.insuranceCosts;
  const vatAmount = Number((taxableAmount * input.vatRate / 100).toFixed(2));
  const total = Number((taxableAmount + vatAmount).toFixed(2));
  return { vatAmount, total };
}