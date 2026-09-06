export function CommercialInvoice() {
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
    director1: "Dr. med Edan Manos",
    director2: "Dr. med Daniel A. Flesch",
  };

  const items = [
    { pos: 1, item: "Biospin Max",         desc: "BSM-01",      hs: "8421.19.99",   qty: 1, unitPrice: "€2.940,00", coo: "USA", total: "€2.940,00",  weight: "28,00 kg" },
    { pos: 2, item: "Mini Stem System",    desc: "MSS",         hs: "9018.90.8400", qty: 5, unitPrice: "€1.112,50", coo: "USA", total: "€5.562,50",  weight: "1,00 kg"  },
    { pos: 3, item: "Setup Accessory Kit", desc: "MSS-SAK-01",  hs: "9018.90.8400", qty: 1, unitPrice: "€200,25",   coo: "USA", total: "€200,25",    weight: "1,00 kg"  },
  ];

  const th = (right = false): React.CSSProperties => ({
    padding: "5px 5px",
    textAlign: right ? "right" : "left",
    fontWeight: 700,
    fontSize: "7px",
    whiteSpace: "nowrap",
    background: NAVY,
    color: "#fff",
  });

  const td = (right = false, bold = false): React.CSSProperties => ({
    padding: "5px 5px",
    textAlign: right ? "right" : "left",
    fontWeight: bold ? 700 : 400,
    fontSize: "7.5px",
    borderBottom: `1px solid ${MID_GRAY}`,
    color: "#222",
  });

  return (
    <div style={{ fontFamily: "Arial, Helvetica, sans-serif", background: "#fff", width: "794px", minHeight: "1123px", margin: "0 auto", padding: "0", fontSize: "9px", position: "relative", boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}>

      {/* ── HEADER: Logo left, title right ── */}
      <div style={{ padding: "24px 40px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <img src="/__mockup/images/logo-iroc-invoice.png" alt="iROC GmbH" style={{ height: "68px", width: "auto" }} />
        <div style={{ color: NAVY, fontWeight: 300, fontSize: "28px", letterSpacing: "2px", textTransform: "uppercase", marginTop: "8px" }}>
          Commercial Invoice
        </div>
      </div>

      {/* ── SEPARATOR + REASON / SHIPPING ROW ── */}
      <div style={{ borderTop: `1px solid ${MID_GRAY}`, margin: "0 40px" }} />
      <div style={{ padding: "5px 40px", display: "flex", justifyContent: "space-between", fontSize: "7.5px" }}>
        <span><span style={{ color: GRAY }}>Reason for Export: </span>Sale</span>
        <span><span style={{ color: GRAY }}>Shipping Method: </span>DHL Express</span>
      </div>
      <div style={{ borderTop: `1px solid ${MID_GRAY}`, margin: "0 40px" }} />

      {/* ── ADDRESS + CONTACT LINE ── */}
      <div style={{ padding: "5px 40px", display: "flex", justifyContent: "space-between", fontSize: "7px", color: GRAY }}>
        <span>{CO.addressLine} | EORI: {CO.eori}</span>
        <div style={{ display: "flex", gap: "40px", flexShrink: 0 }}>
          <div>
            <span style={{ color: GRAY }}>E-Mail Contact: </span>
            <span style={{ color: "#1155cc" }}>{CO.email}</span>
          </div>
          <div>
            <span style={{ color: GRAY }}>Phone Contact: </span>
            <strong style={{ color: "#222" }}>Customer Service<br />{CO.supportPhone}</strong>
          </div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${MID_GRAY}`, margin: "0 40px 14px" }} />

      {/* ── CUSTOMER + REFERENCE GRID ── */}
      <div style={{ padding: "0 40px 12px", display: "flex", gap: "24px", alignItems: "flex-start" }}>

        {/* Left: customer address + incoterms */}
        <div style={{ flex: 1, fontSize: "8px", lineHeight: 1.8 }}>
          <div>Dr. Ranjan Vhadra</div>
          <div>Weighbridge House, Lower</div>
          <div>Pollet, St. Peter Port</div>
          <div>GY1 1WL, Guernsey</div>
          <div>Guernsey</div>
          <div style={{ marginTop: "10px", fontSize: "7.5px" }}>
            <span style={{ color: GRAY, fontWeight: 700 }}>Terms of Delivery (Incoterm): </span>
            DAP Guernsey (Delivered At Place)
          </div>
          <div style={{ fontSize: "7.5px" }}>
            <span style={{ color: GRAY, fontWeight: 700 }}>Reason for Export: </span>
            Permanent Sale / Commercial
          </div>
        </div>

        {/* Right: reference grid + payment box stacked */}
        <div style={{ width: "340px", flexShrink: 0 }}>
          {/* Reference grid */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "7.5px", marginBottom: "8px" }}>
            <tbody>
              <tr>
                <td style={{ padding: "3px 6px", color: GRAY, width: "50%" }}>Order Nr.</td>
                <td style={{ padding: "3px 6px", color: GRAY, width: "50%", borderBottom: `1px solid ${MID_GRAY}` }}>Invoice Nr.*</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 6px" }}></td>
                <td style={{ padding: "3px 6px", fontWeight: 700, borderBottom: `1px solid ${MID_GRAY}`, background: LIGHT_GRAY }}>2026-0044</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 6px", color: GRAY }}>Reference Nr.</td>
                <td style={{ padding: "3px 6px", color: GRAY, borderBottom: `1px solid ${MID_GRAY}` }}>Invoice Issue Date*</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 6px" }}></td>
                <td style={{ padding: "3px 6px", borderBottom: `1px solid ${MID_GRAY}`, background: LIGHT_GRAY }}>18.05.2026</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 6px", color: GRAY }}>Customer Tax/VAT Nr.</td>
                <td style={{ padding: "3px 6px", color: GRAY, borderBottom: `1px solid ${MID_GRAY}` }}>Customer Nr.*</td>
              </tr>
              <tr>
                <td style={{ padding: "3px 6px" }}></td>
                <td style={{ padding: "3px 6px", fontWeight: 700, borderBottom: `1px solid ${MID_GRAY}`, background: LIGHT_GRAY }}>20260015</td>
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: "6.5px", color: GRAY, textAlign: "right", marginBottom: "8px" }}>* Please specify when making payment.</div>

          {/* Payment box */}
          <div style={{ border: `1px solid ${MID_GRAY}`, padding: "9px 11px", fontSize: "7px", lineHeight: 1.7 }}>
            <div style={{ color: GRAY, fontStyle: "italic", marginBottom: "5px" }}>
              The invoice amount is due <strong style={{ textDecoration: "underline" }}>immediately</strong> upon delivery and is to be
              transferred without deduction to the following <strong>account</strong>:
            </div>
            <div style={{ fontWeight: 700 }}>{CO.name}</div>
            <div><span style={{ color: GRAY }}>Bank: </span>{CO.bank}</div>
            <div><span style={{ color: GRAY }}>IBAN: </span>{CO.iban}</div>
            <div><span style={{ color: GRAY }}>BIC/SWIFT: </span>{CO.bic}</div>
          </div>
        </div>
      </div>

      {/* ── LINE ITEMS TABLE ── */}
      <div style={{ margin: "0 40px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th()}>Pos.</th>
              <th style={th()}>Item</th>
              <th style={th()}>Description</th>
              <th style={th()}>HS/HTS code</th>
              <th style={{ ...th(true) }}>Quantity</th>
              <th style={{ ...th(true) }}>Base Unit Price</th>
              <th style={th()}>Country of Origin</th>
              <th style={{ ...th(true) }}>Total incl. Discount</th>
              <th style={{ ...th(true) }}>Item Weight in Kg</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} style={{ background: idx % 2 === 0 ? "#fff" : LIGHT_GRAY }}>
                <td style={td()}>{item.pos}</td>
                <td style={td()}>{item.item}</td>
                <td style={td()}>{item.desc}</td>
                <td style={td()}>{item.hs}</td>
                <td style={td(true)}>{item.qty}</td>
                <td style={td(true)}>{item.unitPrice}</td>
                <td style={td()}>{item.coo}</td>
                <td style={td(true, true)}>{item.total}</td>
                <td style={td(true)}>{item.weight}</td>
              </tr>
            ))}
            {/* Total label row */}
            <tr>
              <td style={{ padding: "4px 5px", fontWeight: 700, fontSize: "8px", borderTop: `2px solid ${NAVY}` }}>Total</td>
              <td colSpan={8} style={{ borderTop: `2px solid ${NAVY}` }} />
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── TOTALS ── */}
      <div style={{ margin: "6px 40px 10px", display: "flex", justifyContent: "flex-end" }}>
        <table style={{ width: "300px", borderCollapse: "collapse", fontSize: "8px" }}>
          <tbody>
            {[
              ["Net Amount",  "€7.111,88", false],
              ["Shipping",    "€250,99",   false],
              ["VAT**",       "€0,00",     false],
            ].map(([label, val]) => (
              <tr key={label as string}>
                <td style={{ padding: "3px 8px", color: GRAY }}>{label}</td>
                <td style={{ padding: "3px 8px", textAlign: "right" }}>{val}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 800 }}>
              <td style={{ padding: "5px 8px", borderTop: `1px solid ${NAVY}` }}>Total Amount</td>
              <td style={{ padding: "5px 8px", textAlign: "right", borderTop: `1px solid ${NAVY}` }}>€7.362,87</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── VAT NOTE ── */}
      <div style={{ margin: "0 40px 8px", color: GRAY, fontSize: "7px", fontStyle: "italic" }}>
        ** Tax-free export delivery according to § 4 No. 1a UStG in conjunction with § 6 UStG.
      </div>

      {/* ── T&C ── */}
      <div style={{ margin: "0 40px 14px", color: "#333", fontSize: "7.5px", lineHeight: 1.6 }}>
        Delivery is made in accordance with our General Terms and Conditions.<br />
        Payment terms: Payment in advance, strictly net without deduction.
      </div>

      {/* ── BLUE BANNER ── */}
      <div style={{ margin: "0 40px 12px", background: BLUE_BANNER, padding: "8px 12px", textAlign: "center", fontSize: "9px", fontWeight: 700, color: NAVY }}>
        Thank you for your business.
      </div>

      {/* ── SIGNATURE SECTION ── */}
      <div style={{ margin: "0 40px 80px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ fontSize: "7.5px", color: "#333", fontStyle: "italic", maxWidth: "340px" }}>
          I declare that the information mentioned above is true and correct to the best of my knowledge.
        </div>
        <div style={{ textAlign: "center" }}>
          <img
            src="/__mockup/images/signature.png"
            alt="Signature"
            style={{ height: "56px", width: "auto", display: "block", marginBottom: "4px", filter: "invert(1)" }}
          />
          <div style={{ borderTop: `1px solid #333`, paddingTop: "4px", fontSize: "7.5px", lineHeight: 1.5 }}>
            {CO.director1}<br />
            CEO, {CO.name}
          </div>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, borderTop: `1px solid ${MID_GRAY}` }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", padding: "8px 40px", gap: "8px" }}>
          {[
            { title: CO.name,              lines: [CO.street, CO.city, CO.country] },
            { title: "Kontakt",            lines: [CO.phone, CO.fax, CO.email, CO.web] },
            { title: "Geschäftsführung",   lines: [CO.director1, CO.director2, `Handelsregister ${CO.hrCity}`, CO.hrb] },
            { title: "Sitz der Gesellschaft", lines: [CO.street, `D-${CO.city}`, CO.country, CO.taxId] },
            { title: "Bankverbindung",     lines: [CO.bank, `BIC/SWIFT: ${CO.bic}`, `IBAN: ${CO.iban}`, `EORI: ${CO.eori}`] },
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
