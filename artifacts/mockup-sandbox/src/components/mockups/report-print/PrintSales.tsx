export function PrintSales() {
  const rows = [
    { name: "Spirecut Kit Premium", sku: "SPK-001", qty: 18, net: 3564.00, vat: 676.16, gross: 4240.16 },
    { name: "MiniStem® Applicator", sku: "MSA-002", qty: 7,  net: 980.00,  vat: 186.20, gross: 1166.20 },
    { name: "Spirecut Refill Set",   sku: "SRS-003", qty: 24, net: 2016.00, vat: 383.04, gross: 2399.04 },
    { name: "Training Material DE",  sku: "TM-004",  qty: 10, net: 750.00,  vat: 142.50, gross: 892.50 },
    { name: "Consulting (hourly)",   sku: "CONS-01", qty: 4,  net: 600.00,  vat: 114.00, gross: 714.00 },
  ];
  const totNet = rows.reduce((s, r) => s + r.net, 0);
  const totGross = rows.reduce((s, r) => s + r.gross, 0);

  return (
    <div className="bg-white min-h-screen font-sans text-[11px]" style={{ padding: "24px 28px" }}>
      {/* Print-only page header */}
      <div className="flex items-center justify-between border-b border-gray-400 pb-3 mb-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">Bericht: Q2 2026</h2>
          <p className="text-[10px] text-gray-500">Erstellt am 5. August 2026</p>
        </div>
        <span className="text-[10px] text-gray-400">iROC GmbH</span>
      </div>

      {/* Section header bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-t-md">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Umsatz</span>
      </div>

      <div className="border border-t-0 border-gray-200 rounded-b-md px-3 pb-3 pt-3 space-y-3">
        {/* KPI row */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Rechnungen", value: "23" },
            { label: "Umsatz Netto", value: "€ 7.910" },
            { label: "Umsatz Brutto", value: "€ 9.412" },
            { label: "Ø pro Rechnung", value: "€ 344" },
          ].map(k => (
            <div key={k.label} className="border border-gray-200 rounded p-2">
              <p className="text-[9px] text-gray-500 leading-tight">{k.label}</p>
              <p className="text-sm font-bold mt-0.5 text-gray-900">{k.value}</p>
            </div>
          ))}
        </div>

        {/* Revenue breakdown */}
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400">Umsatz nach Kategorie</p>
          </div>
          <table className="w-full" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-2 py-1 font-semibold text-gray-700 w-[30%]">Produkt</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[14%]">SKU</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[10%] text-right">Qty</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[15%] text-right">Netto</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[12%] text-right">MwSt.</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[15%] text-right">Brutto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-2 py-1 font-medium text-gray-900 truncate">{r.name}</td>
                  <td className="px-2 py-1 text-gray-500 font-mono text-[9px]">{r.sku}</td>
                  <td className="px-2 py-1 text-right text-gray-700">{r.qty}</td>
                  <td className="px-2 py-1 text-right text-gray-700">€ {r.net.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right text-gray-500">€ {r.vat.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right font-semibold text-gray-900">€ {r.gross.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-300">
                <td colSpan={3} className="px-2 py-1 font-bold text-gray-900">Gesamt</td>
                <td className="px-2 py-1 text-right font-bold text-gray-900">€ {totNet.toFixed(2)}</td>
                <td />
                <td className="px-2 py-1 text-right font-bold text-gray-900">€ {totGross.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Spirecut vs. Other split */}
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400">Spirecut vs. Sonstige</p>
          </div>
          <table className="w-full" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-2 py-1 font-semibold text-gray-700 w-1/3">Kategorie</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-1/3 text-right">Netto</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-1/3 text-right">Anteil</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="px-2 py-1 font-medium text-gray-900">Spirecut</td>
                <td className="px-2 py-1 text-right text-gray-700">€ 6.560,00</td>
                <td className="px-2 py-1 text-right font-semibold text-gray-900">83 %</td>
              </tr>
              <tr>
                <td className="px-2 py-1 font-medium text-gray-900">Sonstige</td>
                <td className="px-2 py-1 text-right text-gray-700">€ 1.350,00</td>
                <td className="px-2 py-1 text-right font-semibold text-gray-900">17 %</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
