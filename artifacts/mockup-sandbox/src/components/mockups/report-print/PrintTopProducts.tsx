export function PrintTopProducts() {
  const products = [
    { rank: 1, name: "Spirecut Kit Premium",  sku: "SPK-001", qty: 18, revenue: 3564.00, share: 45 },
    { rank: 2, name: "Spirecut Refill Set",    sku: "SRS-003", qty: 24, revenue: 2016.00, share: 25 },
    { rank: 3, name: "MiniStem® Applicator",   sku: "MSA-002", qty: 7,  revenue: 980.00,  share: 12 },
    { rank: 4, name: "Training Material DE",   sku: "TM-004",  qty: 10, revenue: 750.00,  share: 9  },
    { rank: 5, name: "Consulting (hourly)",    sku: "CONS-01", qty: 4,  revenue: 600.00,  share: 8  },
  ];

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

      {/* Section header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-t-md">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Top Produkte</span>
      </div>

      <div className="border border-t-0 border-gray-200 rounded-b-md px-3 pb-3 pt-3 space-y-3">
        {/* KPI row */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Produkte verkauft", value: "5 SKUs" },
            { label: "Top-Performer", value: "Spirecut Kit Premium" },
            { label: "Gesamtumsatz", value: "€ 7.910" },
          ].map(k => (
            <div key={k.label} className="border border-gray-200 rounded p-2">
              <p className="text-[9px] text-gray-500 leading-tight">{k.label}</p>
              <p className="text-[11px] font-bold mt-0.5 text-gray-900 truncate">{k.value}</p>
            </div>
          ))}
        </div>

        {/* Ranked table */}
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400">Top Produkte nach Umsatz</p>
          </div>
          <table className="w-full" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-2 py-1 font-semibold text-gray-700 w-[6%] text-center">#</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[34%]">Produkt</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[14%]">SKU</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[10%] text-right">Menge</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[16%] text-right">Umsatz</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[20%] text-right">Anteil</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.rank} className="border-b border-gray-100">
                  <td className="px-2 py-1 text-center font-bold text-gray-400">{p.rank}</td>
                  <td className="px-2 py-1 font-medium text-gray-900 truncate">{p.name}</td>
                  <td className="px-2 py-1 text-gray-500 font-mono text-[9px]">{p.sku}</td>
                  <td className="px-2 py-1 text-right text-gray-700">{p.qty}</td>
                  <td className="px-2 py-1 text-right font-semibold text-gray-900">€ {p.revenue.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${p.share}%` }} />
                      </div>
                      <span className="font-semibold text-gray-700 w-6 text-right">{p.share}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
