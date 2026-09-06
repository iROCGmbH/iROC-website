export function StandardInvoice() {
  const NAVY = "#002244";
  const BLUE_BANNER = "#cce0f5";
  const GRAY = "#555";
  const LIGHT_GRAY = "#f5f5f5";
  const MID_GRAY = "#ddd";

  const CO = {
    name: "iROC GmbH",
    street: "St. Emmeram-Str. 26",
    city: "85609 Aschheim",
    country: "Deutschland",
    addressLine: "iROC GmbH | St.-Emmeram-Str. 26 | 85609 Aschheim",
    email: "info@i-roc.de",
    phone: "T +49 89 4625993 70",
    fax: "F +49 89 21530 334",
    web: "www.i-roc.de",
    supportPhone: "+49 (0)89 600 60 805",
    bank: "MERKUR PRIVATBANK München",
    iban: "DE85 7013 0800 0001 1395 50",
    bic: "GENODEF1M06",
    eori: "DE990485776181558",
    hrb: "HRB 303391",
    hrCity: "München",
    taxId: "DE455683037",
    director1: "Dr. med Ertan Manos",
    director2: "Dr. med Daniel A. Flesch",
  };

  const items = [
    { pos: 1, artikel: "Mini Stem System", desc: "MSS", lot: "5012154", qty: 6, grundpreis: "€1.112,50", rabatt: "30%", rabattpreis: "€778,75", gesamt: "€4.672,50" },
    { pos: 2, artikel: "Spirecut® Set", desc: "SPC", lot: "2024-SPC-0041", qty: 2, grundpreis: "€850,00", rabatt: "—", rabattpreis: "€850,00", gesamt: "€1.700,00" },
  ];

  const cellStyle = (right = false, bold = false): React.CSSProperties => ({
    padding: "5px 6px",
    textAlign: right ? "right" : "left",
    fontWeight: bold ? 700 : 400,
    fontSize: "8px",
    color: "#222",
    borderBottom: `1px solid ${MID_GRAY}`,
  });

  return (
    <div style={{ fontFamily: "Arial, Helvetica, sans-serif", background: "#fff", width: "794px", minHeight: "1123px", margin: "0 auto", padding: "0", fontSize: "9px", position: "relative", boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}>

      {/* ── HEADER: Logo left, Invoice right ── */}
      <div style={{ padding: "28px 40px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <img src="/__mockup/images/logo-iroc-invoice.png" alt="iROC GmbH" style={{ height: "72px", width: "auto" }} />
        <div style={{ color: NAVY, fontWeight: 400, fontSize: "32px", letterSpacing: "0.5px" }}>Invoice</div>
      </div>

      {/* ── THIN ADDRESS LINE + RÜCKFRAGEN ── */}
      <div style={{ padding: "0 40px 8px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ color: GRAY, fontSize: "7px", borderBottom: `1px solid ${MID_GRAY}`, paddingBottom: "4px", flex: 1 }}>
          {CO.addressLine}
        </div>
        <div style={{ display: "flex", gap: "32px", marginLeft: "32px", fontSize: "7.5px", paddingBottom: "4px", borderBottom: `1px solid ${MID_GRAY}`, flexShrink: 0 }}>
          <div>
            <div style={{ color: GRAY, marginBottom: "2px" }}>Rücksendeanfrage an:</div>
            <div style={{ color: "#1155cc", textDecoration: "underline" }}>{CO.email}</div>
          </div>
          <div>
            <div style={{ color: GRAY, marginBottom: "2px" }}>Rückfragen an:</div>
            <div style={{ fontWeight: 700 }}>Kundenberatung</div>
            <div>{CO.supportPhone}</div>
          </div>
        </div>
      </div>

      {/* ── CUSTOMER + REFERENCE GRID ── */}
      <div style={{ padding: "16px 40px", display: "flex", gap: "24px", alignItems: "flex-start" }}>
        {/* Bill-to block */}
        <div style={{ flex: 1, fontSize: "8.5px", lineHeight: 1.7 }}>
          <div style={{ fontWeight: 400 }}>Dr. med Daniel A. Flesch</div>
          <div>St. Emmeram Straße 5</div>
          <div>85609, Aschheim</div>
          <div>Deutschland</div>
        </div>

        {/* Reference grid — 2 columns matching template */}
        <div style={{ width: "340px", flexShrink: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8px" }}>
            <tbody>
              <tr>
                <td style={{ padding: "3px 6px", color: GRAY, width: "50%" }}>Auftragsnummer</td>
                <td style={{ padding: "3px 6px", fontWeight: 700, borderBottom: `1px solid ${MID_GRAY}`, width: "50%", background: LIGHT_GRAY }}>Rechnungsnummer*</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 6px" }}></td>
                <td style={{ padding: "3px 6px", fontWeight: 700, borderBottom: `1px solid ${MID_GRAY}`, background: LIGHT_GRAY }}>2026-0077</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 6px", color: GRAY }}>Ihre Referenz</td>
                <td style={{ padding: "3px 6px", color: GRAY, borderBottom: `1px solid ${MID_GRAY}` }}>Rechnungsdatum*</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 6px" }}></td>
                <td style={{ padding: "3px 6px", borderBottom: `1px solid ${MID_GRAY}` }}>24.07.2026</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 6px", color: GRAY }}>Ihre Ust-ID-Nummer</td>
                <td style={{ padding: "3px 6px", color: GRAY, borderBottom: `1px solid ${MID_GRAY}` }}>Kundenummer*</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 6px" }}>DE427650789</td>
                <td style={{ padding: "3px 6px", borderBottom: `1px solid ${MID_GRAY}` }}>20260001</td>
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: "6.5px", color: GRAY, textAlign: "right", marginTop: "2px" }}>* bei Zahlung bitte angeben</div>
        </div>
      </div>

      {/* ── PAYMENT BOX ── */}
      <div style={{ margin: "0 40px 14px", border: `1px solid ${MID_GRAY}`, padding: "10px 12px", fontSize: "7.5px", display: "flex", gap: "0" }}>
        <div style={{ flex: 1, color: GRAY, fontStyle: "italic", lineHeight: 1.6, paddingRight: "16px" }}>
          Der Rechnungsbetrag ist <strong style={{ textDecoration: "underline" }}>sofort</strong> nach Lieferung fällig und ohne Abzug
          auf Kontoinhaber folgendes <strong>Konto</strong> zu überweisen:
        </div>
        <div style={{ borderLeft: `1px solid ${MID_GRAY}`, paddingLeft: "16px", lineHeight: 1.8 }}>
          <div style={{ fontWeight: 700 }}>{CO.name}</div>
          <div><span style={{ color: GRAY }}>Bank: </span>{CO.bank}</div>
          <div><span style={{ color: GRAY }}>IBAN: </span>{CO.iban}</div>
          <div><span style={{ color: GRAY }}>BIC/SWIFT: </span>{CO.bic}</div>
        </div>
      </div>

      {/* ── LINE ITEMS TABLE ── */}
      <div style={{ margin: "0 40px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8px" }}>
          <thead>
            <tr style={{ background: NAVY, color: "#fff" }}>
              {["Pos.", "Artikel", "Beschreibung", "LOT-Nr.", "Menge", "Grundpreis", "Rabatt", "Rabattpreis", "Gesamt"].map((h, i) => (
                <th key={h} style={{ padding: "5px 6px", textAlign: i >= 4 ? "right" : "left", fontWeight: 700, fontSize: "7.5px", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} style={{ background: idx % 2 === 0 ? "#fff" : LIGHT_GRAY }}>
                <td style={cellStyle()}>{item.pos}</td>
                <td style={cellStyle()}>{item.artikel}</td>
                <td style={cellStyle()}>{item.desc}</td>
                <td style={cellStyle()}>{item.lot}</td>
                <td style={cellStyle(true)}>{item.qty}</td>
                <td style={cellStyle(true)}>{item.grundpreis}</td>
                <td style={cellStyle(true)}>{item.rabatt}</td>
                <td style={cellStyle(true)}>{item.rabattpreis}</td>
                <td style={cellStyle(true, true)}>{item.gesamt}</td>
              </tr>
            ))}
            {/* Subtotal label row */}
            <tr>
              <td colSpan={2} style={{ padding: "4px 6px", fontWeight: 700, fontSize: "8px", borderTop: `2px solid ${NAVY}` }}>Gesamt</td>
              <td colSpan={7} style={{ borderTop: `2px solid ${NAVY}` }} />
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── TOTALS ── */}
      <div style={{ margin: "6px 40px 10px", display: "flex", justifyContent: "flex-end" }}>
        <table style={{ width: "300px", borderCollapse: "collapse", fontSize: "8px" }}>
          <tbody>
            {[
              ["Netto-Betrag", "€6.372,50", false],
              ["Lieferung", "€0,00", false],
              ["Umsatzsteuer 19% **", "€1.210,78", false],
            ].map(([label, val]) => (
              <tr key={label as string}>
                <td style={{ padding: "3px 8px", color: GRAY }}>{label}</td>
                <td style={{ padding: "3px 8px", textAlign: "right" }}>{val}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 800 }}>
              <td style={{ padding: "5px 8px", borderTop: `1px solid ${NAVY}` }}>Gesamtbetrag</td>
              <td style={{ padding: "5px 8px", textAlign: "right", borderTop: `1px solid ${NAVY}` }}>€7.583,28</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── VAT NOTE ── */}
      <div style={{ margin: "0 40px 10px", color: GRAY, fontSize: "7px", fontStyle: "italic" }}>
        ** Steuerpflichtige Lieferung.
      </div>

      {/* ── T&C ── */}
      <div style={{ margin: "0 40px 14px", color: "#333", fontSize: "7.5px", lineHeight: 1.6 }}>
        Die Lieferung und Leistung erfolgt ausschließlich zu unseren allgemeinen Verkaufsbedingungen, die Sie hier{" "}
        <span style={{ color: "#1155cc" }}>www.i-roc.de/AVB/</span> einsehen können.<br />
        Zahlungsbedingung: Vorkasse rein netto ohne Abzug.
      </div>

      {/* ── BLUE BANNER ── */}
      <div style={{ margin: "0 40px 0", background: BLUE_BANNER, padding: "8px 12px", textAlign: "center", fontSize: "9px", fontWeight: 700, color: NAVY }}>
        Vielen Dank für Ihren Auftrag.
      </div>

      {/* ── FOOTER ── */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, borderTop: `1px solid ${MID_GRAY}` }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", padding: "8px 40px", gap: "8px" }}>
          {[
            {
              title: CO.name,
              lines: [CO.street, CO.city, CO.country],
            },
            {
              title: "Kontakt",
              lines: [CO.phone, CO.fax, CO.email, CO.web],
            },
            {
              title: "Geschäftsführung",
              lines: [CO.director1, CO.director2, `Handelsregister ${CO.hrCity}`, CO.hrb],
            },
            {
              title: "Sitz der Gesellschaft",
              lines: [CO.street, `D-${CO.city}`, CO.country, CO.taxId],
            },
            {
              title: "Bankverbindung",
              lines: [CO.bank, `BIC/SWIFT: ${CO.bic}`, `IBAN: ${CO.iban}`, `EORI: ${CO.eori}`],
            },
          ].map((col) => (
            <div key={col.title} style={{ fontSize: "6.5px", lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, marginBottom: "2px" }}>{col.title}</div>
              {col.lines.map((l) => <div key={l} style={{ color: GRAY }}>{l}</div>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
