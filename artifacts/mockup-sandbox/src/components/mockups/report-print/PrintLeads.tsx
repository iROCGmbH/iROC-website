export function PrintLeads() {
  const statuses = [
    { label: "Neu",          count: 8,  prev: 5 },
    { label: "Kontaktiert",  count: 14, prev: 11 },
    { label: "Qualifiziert", count: 6,  prev: 9 },
    { label: "Konvertiert",  count: 5,  prev: 3 },
  ];

  const leads = [
    { name: "Dr. A. Müller",   instrument: "Spirecut",  status: "Konvertiert", date: "12.04.2026" },
    { name: "Dr. B. Schmidt",  instrument: "MiniStem",  status: "Qualifiziert", date: "20.04.2026" },
    { name: "Dr. C. Weber",    instrument: "Spirecut",  status: "Kontaktiert", date: "02.05.2026" },
    { name: "Dr. D. Fischer",  instrument: "Spirecut",  status: "Neu",         date: "14.05.2026" },
    { name: "Dr. E. Bauer",    instrument: "MiniStem",  status: "Konvertiert", date: "28.05.2026" },
    { name: "Dr. F. Koch",     instrument: "Spirecut",  status: "Kontaktiert", date: "03.06.2026" },
  ];

  const statusColor: Record<string, string> = {
    "Konvertiert": "text-green-700",
    "Qualifiziert": "text-blue-700",
    "Kontaktiert": "text-orange-600",
    "Neu": "text-gray-600",
  };

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
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Leads</span>
      </div>

      <div className="border border-t-0 border-gray-200 rounded-b-md px-3 pb-3 pt-3 space-y-3">
        {/* KPI row */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Neue Leads", value: "33" },
            { label: "Konvertiert", value: "5" },
            { label: "Konversionsrate", value: "15,2 %" },
            { label: "Leads gesamt", value: "147" },
          ].map(k => (
            <div key={k.label} className="border border-gray-200 rounded p-2">
              <p className="text-[9px] text-gray-500 leading-tight">{k.label}</p>
              <p className="text-sm font-bold mt-0.5 text-gray-900">{k.value}</p>
            </div>
          ))}
        </div>

        {/* Status breakdown */}
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400">Status-Verteilung</p>
          </div>
          <table className="w-full" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-2 py-1 font-semibold text-gray-700 w-1/3">Status</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-1/3 text-right">Aktuell</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-1/3 text-right">Vorperiode</th>
              </tr>
            </thead>
            <tbody>
              {statuses.map((s, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-2 py-1 font-medium text-gray-900">{s.label}</td>
                  <td className="px-2 py-1 text-right font-semibold text-gray-900">{s.count}</td>
                  <td className="px-2 py-1 text-right text-gray-400">{s.prev}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Lead list */}
        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400">Lead-Liste (Periode)</p>
          </div>
          <table className="w-full" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="px-2 py-1 font-semibold text-gray-700 w-[30%]">Name</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[25%]">Instrument</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[25%]">Status</th>
                <th className="px-2 py-1 font-semibold text-gray-700 w-[20%] text-right">Datum</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-2 py-1 font-medium text-gray-900">{l.name}</td>
                  <td className="px-2 py-1 text-gray-600">{l.instrument}</td>
                  <td className={`px-2 py-1 font-medium ${statusColor[l.status]}`}>{l.status}</td>
                  <td className="px-2 py-1 text-right text-gray-500">{l.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
