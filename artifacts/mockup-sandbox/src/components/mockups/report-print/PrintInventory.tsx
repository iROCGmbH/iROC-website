export function PrintInventory() {
  const rows = [
    { name: "Spirecut Kit Premium", sku: "SPK-001", lot: "L-2024-001", qty: 12, price: 228.00 },
    { name: "MiniStem® Applicator", sku: "MSA-002", lot: "L-2024-002", qty: 3, price: 145.00 },
    { name: "Spirecut Refill Set", sku: "SRS-003", lot: "L-2024-003", qty: 8, price: 98.50 },
    { name: "Training Material DE", sku: "TM-004",  lot: "L-2024-004", qty: 25, price: 0 },
    { name: "Spirecut Kit Standard", sku: "SPK-005", lot: "L-2025-001", qty: 5, price: 185.00 },
  ];
  const total = rows.reduce((s, r) => s + r.qty * r.price, 0);

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
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-t-md mb-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Inventar</span>
      </div>

      {/* Body */}
      <div className="border border-t-0 border-gray-200 rounded-b-md px-3 pb-3 pt-3 space-y-3">
        <p className="text-[9px] text-gray-400">Aktueller Lagerbestand — keine Periodenfilterung</p>

        {/* KPI row */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "SKUs auf Lager", value: "5" },
            { label: "Einheiten gesamt", value: "53" },
            { label: "Lagerwert (EK)", value: "€ 5.837,50" },
            { label: "Niedriger Bestand", value: "2", red: true },
          ].map(k => (
            <div key={k.label} className="border border-gray-200 rounded p-2">
              <p className="text-[9px] text-gray-500 leading-tight">{k.label}</p>
              <p className={`text-sm font-bold mt-0.5 ${k.red ? "text-red-600" : "text-gray-900"}`}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* Inventarverzeichnis */}
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
            <p className="text-[10px] font-bold text-gray-800">Inventarverzeichnis zum Stichtag 31.12.2026</p>
          </div>
          <table className="w-full" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-2 py-1 font-semibold text-gray-700 w-[28%]">Produkt</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[16%]">SKU</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[18%] font-mono">LOT-Nr.</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[10%] text-right">Qty</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[14%] text-right">Einzelpreis</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[14%] text-right">Summe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-2 py-1 font-medium text-gray-900 truncate">{r.name}</td>
                  <td className="px-2 py-1 text-gray-500 font-mono truncate">{r.sku}</td>
                  <td className="px-2 py-1 font-mono text-gray-700">{r.lot}</td>
                  <td className="px-2 py-1 text-right font-semibold text-gray-900">{r.qty}</td>
                  <td className="px-2 py-1 text-right text-gray-700">{r.price > 0 ? `€ ${r.price.toFixed(2)}` : "—"}</td>
                  <td className="px-2 py-1 text-right font-semibold text-gray-900">
                    {r.price > 0 ? `€ ${(r.qty * r.price).toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-300">
                <td colSpan={5} className="px-2 py-1 font-bold text-gray-900">Summe</td>
                <td className="px-2 py-1 text-right font-bold text-gray-900">€ {total.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          {/* Signature block */}
          <div className="px-3 py-4 border-t border-gray-200">
            <div className="mt-4 border-t border-gray-400 pt-2 text-[9px] text-gray-500 w-64">
              Aschheim, 31.12.2026 – Unterschrift Geschäftsführung / iROC GmbH
            </div>
          </div>
        </div>

        {/* Low-stock panel */}
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400">Artikel mit niedrigem Bestand (≤ 5)</p>
          </div>
          <table className="w-full">
            <tbody>
              {[
                { name: "MiniStem® Applicator", lot: "L-2024-002", qty: 3 },
                { name: "Spirecut Kit Standard", lot: "L-2025-001", qty: 5 },
              ].map((r, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-3 py-1 font-medium text-gray-900">{r.name}</td>
                  <td className="px-3 py-1 text-gray-400 font-mono text-[9px]">LOT {r.lot}</td>
                  <td className="px-3 py-1 text-right font-semibold text-red-600">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
