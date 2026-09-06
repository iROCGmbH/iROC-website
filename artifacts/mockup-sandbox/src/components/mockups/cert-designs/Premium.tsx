export default function Premium() {
  return (
    <div className="w-full min-h-screen flex items-center justify-center" style={{ background: '#ECEEF2' }}>
      <div 
        className="relative overflow-hidden flex"
        style={{ 
          width: '1240px', 
          height: '877px',
          boxShadow: '0 4px 40px rgba(0,28,66,0.18)'
        }}
      >
        {/* LEFT SIDEBAR */}
        <div 
          className="flex flex-col items-center justify-between"
          style={{ 
            width: '200px',
            height: '100%',
            background: '#002E56',
            padding: '28px 16px'
          }}
        >
          {/* Top: iROC Logo */}
          <div className="flex items-center justify-center">
            <img 
              src="/__mockup/images/cert/logo-iroc-cert.png" 
              alt="iROC"
              className="object-contain"
              style={{ 
                maxWidth: '80px',
                filter: 'brightness(0) invert(1)'
              }}
            />
          </div>

          {/* Center: Rotated ZERTIFIKAT + decorative lines */}
          <div className="flex flex-col items-center gap-4">
            <div 
              className="whitespace-nowrap"
              style={{
                transform: 'rotate(-90deg)',
                fontSize: '18px',
                fontWeight: 800,
                letterSpacing: '8px',
                color: 'rgba(255,255,255,0.15)'
              }}
            >
              ZERTIFIKAT
            </div>
            <div className="flex flex-col items-center gap-1">
              <div style={{ width: '40px', height: '1px', background: 'rgba(255,255,255,0.3)' }} />
              <div style={{ width: '40px', height: '1px', background: 'rgba(255,255,255,0.3)' }} />
              <div style={{ width: '40px', height: '1px', background: 'rgba(255,255,255,0.3)' }} />
            </div>
          </div>

          {/* Bottom: iROC GmbH */}
          <div 
            className="text-center uppercase"
            style={{
              fontSize: '8px',
              color: 'rgba(255,255,255,0.5)',
              letterSpacing: '2px'
            }}
          >
            iROC GmbH
          </div>
        </div>

        {/* RIGHT CONTENT */}
        <div 
          className="flex-1 flex flex-col justify-between"
          style={{ 
            background: 'white',
            padding: '28px 36px'
          }}
        >
          {/* HEADER ROW */}
          <div className="flex justify-between items-start">
            <img 
              src="/__mockup/images/cert/logo-spirecut-cert.png" 
              alt="Spirecut"
              className="object-contain"
              style={{ maxHeight: '38px' }}
            />
            <div 
              className="text-right whitespace-pre-line"
              style={{ 
                fontSize: '6px',
                color: '#002E56',
                lineHeight: '1.6'
              }}
            >
              Innovative & Regenerative{'\n'}medical Oriented Consultation
            </div>
          </div>

          {/* Horizontal rule */}
          <div style={{ height: '2px', background: '#0070C0', margin: '14px 0' }} />

          {/* ZERTIFIKAT heading */}
          <div>
            <div 
              style={{
                fontSize: '44px',
                fontWeight: 800,
                color: '#002E56',
                letterSpacing: '4px',
                lineHeight: '1'
              }}
            >
              ZERTIFIKAT
            </div>
            <div 
              style={{ 
                width: '80px', 
                height: '2px', 
                background: '#0070C0',
                marginTop: '8px',
                marginBottom: '16px'
              }} 
            />
          </div>

          {/* Body text */}
          <div 
            className="text-left"
            style={{ 
              fontSize: '11px',
              color: '#222',
              lineHeight: '1.8'
            }}
          >
            <p className="mb-1">
              Hiermit wird bestätigt, dass <strong>Dr. med. Maria Müller, wohnhaft in München</strong>
            </p>
            <p>
              am <strong>14. März 2026</strong> erfolgreich an der Schulung zum Thema:
            </p>
          </div>

          {/* Course title */}
          <div 
            style={{
              fontSize: '18px',
              fontWeight: 700,
              color: '#0070C0',
              margin: '10px 0 6px',
              textAlign: 'left'
            }}
          >
            "Spirecut® Instrumente und Technik für KTS und SF"
          </div>

          {/* Continuation */}
          <div 
            style={{ 
              fontSize: '11px',
              color: '#222',
              lineHeight: '1.8',
              textAlign: 'left'
            }}
          >
            durchgeführt von iROC GmbH in Aschheim teilgenommen hat.
          </div>

          {/* Divider */}
          <div style={{ height: '1px', background: '#E5EAF0', margin: '12px 0' }} />

          {/* Training content section */}
          <div>
            <div 
              style={{
                fontSize: '13px',
                fontWeight: 700,
                color: '#002E56',
                marginBottom: '8px'
              }}
            >
              Inhalte der Schulung:
            </div>
            <ul className="space-y-1" style={{ listStyle: 'none', padding: 0 }}>
              <li 
                style={{ 
                  fontSize: '12px',
                  color: '#333',
                  lineHeight: '1.7',
                  paddingLeft: '20px',
                  position: 'relative'
                }}
              >
                <span style={{ position: 'absolute', left: 0, color: '#0070C0' }}>•</span>
                Anwendung und Handling der Spirecut® Instrumente
              </li>
              <li 
                style={{ 
                  fontSize: '12px',
                  color: '#333',
                  lineHeight: '1.7',
                  paddingLeft: '20px',
                  position: 'relative'
                }}
              >
                <span style={{ position: 'absolute', left: 0, color: '#0070C0' }}>•</span>
                Spezifikationen für KTS- und SF-Modelle
              </li>
              <li 
                style={{ 
                  fontSize: '12px',
                  color: '#333',
                  lineHeight: '1.7',
                  paddingLeft: '20px',
                  position: 'relative'
                }}
              >
                <span style={{ position: 'absolute', left: 0, color: '#0070C0' }}>•</span>
                Sicherheit und optimaler Einsatz
              </li>
              <li 
                style={{ 
                  fontSize: '12px',
                  color: '#333',
                  lineHeight: '1.7',
                  paddingLeft: '20px',
                  position: 'relative'
                }}
              >
                <span style={{ position: 'absolute', left: 0, color: '#0070C0' }}>•</span>
                Pflege und Wartung der Instrumente
              </li>
            </ul>
          </div>

          {/* FOOTER ROW */}
          <div className="flex justify-between items-end" style={{ marginTop: 'auto', paddingTop: '8px' }}>
            {/* Left: Date */}
            <div 
              style={{
                fontSize: '9px',
                fontWeight: 700,
                color: '#0070C0'
              }}
            >
              Aschheim, den 14. März 2026
            </div>

            {/* Right: Signature block */}
            <div className="flex flex-col items-center" style={{ width: '200px' }}>
              <img 
                src="/__mockup/images/cert/signature-filesch.png" 
                alt="Signature"
                className="object-contain"
                style={{ maxHeight: '44px', marginBottom: '4px' }}
              />
              <div style={{ width: '100%', height: '1px', background: '#333', marginBottom: '6px' }} />
              <div 
                className="text-center"
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#002E56'
                }}
              >
                Dr. med Daniel A. Filesch, iROC GmbH
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
