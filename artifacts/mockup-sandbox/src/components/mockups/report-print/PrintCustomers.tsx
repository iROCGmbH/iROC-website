export function PrintCustomers() {
  const customers = [
    { name: "Dr. A. Müller",  city: "München",  instrument: "Spirecut",  invoices: 4,  total: 2240.00, since: "Jan 2024" },
    { name: "Dr. B. Schmidt", city: "Hamburg",   instrument: "MiniStem",  invoices: 2,  total: 980.00,  since: "Feb 2024" },
    { name: "Dr. C. Weber",   city: "Berlin",    instrument: "Spirecut",  invoices: 6,  total: 3360.00, since: "Mär 2023" },
    { name: "Dr. D. Fischer", city: "Frankfurt", instrument: "Spirecut",  invoices: 1,  total: 560.00,  since: "Apr 2026" },
    { name: "Dr. E. Bauer",   city: "Köln",      instrument: "MiniStem",  invoices: 3,  total: 1440.00, since: "Nov 2024" },
    { name: "Dr. F. Koch",    city: "Stuttgart", instrument: "Spirecut",  invoices: 2,  total: 1120.00, since: "Jun 2025" },
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
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Kunden</span>
      </div>

      <div className="border border-t-0 border-gray-200 rounded-b-md px-3 pb-3 pt-3 space-y-3">
        {/* KPI row */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Neue Kunden", value: "6" },
            { label: "Aktive Kunden", value: "41" },
            { label: "Spirecut-Anteil", value: "67 %" },
            { label: "Ø Umsatz/Kunde", value: "€ 1.617" },
          ].map(k => (
            <div key={k.label} className="border border-gray-200 rounded p-2">
              <p className="text-[9px] text-gray-500 leading-tight">{k.label}</p>
              <p className="text-sm font-bold mt-0.5 text-gray-900">{k.value}</p>
            </div>
          ))}
        </div>

        {/* Customer list */}
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400">Neue Kunden (Periode)</p>
          </div>
          <table className="w-full" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-2 py-1 font-semibold text-gray-700 w-[26%]">Name</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[18%]">Stadt</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[18%]">Instrument</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[10%] text-right">Rg.</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[16%] text-right">Umsatz</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[12%] text-right">Seit</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-2 py-1 font-medium text-gray-900 truncate">{c.name}</td>
                  <td className="px-2 py-1 text-gray-600">{c.city}</td>
                  <td className="px-2 py-1 text-gray-600">{c.instrument}</td>
                  <td className="px-2 py-1 text-right text-gray-700">{c.invoices}</td>
                  <td className="px-2 py-1 text-right font-semibold text-gray-900">€ {c.total.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right text-gray-400">{c.since}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
