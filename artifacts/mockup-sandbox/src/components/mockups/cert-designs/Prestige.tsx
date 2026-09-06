export default function Prestige() {
  return (
    <div className="w-full min-h-screen flex items-center justify-center bg-gray-50 p-8">
      {/* Certificate container - exact A4 landscape dimensions */}
      <div
        style={{
          width: '1240px',
          height: '877px',
          overflow: 'hidden',
          position: 'relative',
        }}
        className="bg-[#FFFEF8] shadow-2xl"
      >
        {/* Double border frame */}
        <div
          style={{
            position: 'absolute',
            inset: '0',
            border: '3px solid #002E56',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '9px',
              border: '1px solid #C9A227',
              pointerEvents: 'none',
            }}
          />
        </div>

        {/* Watermark */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: '200px',
            fontWeight: '900',
            color: '#002E56',
            opacity: '0.03',
            letterSpacing: '20px',
            fontFamily: 'Georgia, serif',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          iROC
        </div>

        {/* Content wrapper with padding */}
        <div
          style={{
            padding: '18px 24px',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header row with logos */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              paddingBottom: '12px',
            }}
          >
            {/* Left logo */}
            <img
              src="/__mockup/images/cert/logo-spirecut-cert.png"
              alt="Spirecut"
              style={{ maxHeight: '44px', objectFit: 'contain' }}
            />

            {/* Right logo + tagline */}
            <div style={{ textAlign: 'right' }}>
              <img
                src="/__mockup/images/cert/logo-iroc-cert.png"
                alt="iROC"
                style={{ maxHeight: '36px', objectFit: 'contain', marginBottom: '4px' }}
              />
              <div
                style={{
                  fontSize: '7px',
                  color: '#002E56',
                  lineHeight: '1.3',
                  whiteSpace: 'pre-line',
                }}
              >
                Innovative & Regenerative{'\n'}medical Oriented Consultation
              </div>
            </div>
          </div>

          {/* Gold separator line */}
          <div
            style={{
              width: '100%',
              height: '1px',
              backgroundColor: '#C9A227',
              marginBottom: '24px',
            }}
          />

          {/* Title section */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <h1
              style={{
                fontSize: '52px',
                fontWeight: '800',
                color: '#002E56',
                letterSpacing: '6px',
                fontFamily: 'Georgia, serif',
                marginBottom: '8px',
              }}
            >
              ZERTIFIKAT
            </h1>
            <div
              style={{
                width: '60px',
                height: '3px',
                backgroundColor: '#C9A227',
                margin: '0 auto',
              }}
            />
          </div>

          {/* Body text */}
          <div
            style={{
              textAlign: 'center',
              fontSize: '11px',
              color: '#1a1a1a',
              lineHeight: '1.8',
              marginBottom: '10px',
            }}
          >
            Hiermit wird bestätigt, dass <strong>Dr. med. Maria Müller, wohnhaft in München</strong>
            <br />
            am <strong>14. März 2026</strong> erfolgreich an der Schulung zum Thema:
          </div>

          {/* Course title */}
          <div
            style={{
              textAlign: 'center',
              fontSize: '22px',
              fontWeight: '700',
              color: '#002E56',
              marginTop: '10px',
              marginBottom: '8px',
            }}
          >
            "Spirecut® Instrumente und Technik für KTS und SF"
          </div>

          {/* Completion text */}
          <div
            style={{
              textAlign: 'center',
              fontSize: '11px',
              color: '#1a1a1a',
              lineHeight: '1.8',
              marginBottom: '12px',
            }}
          >
            durchgeführt von iROC GmbH in Aschheim teilgenommen hat.
          </div>

          {/* Contents section */}
          <div style={{ marginTop: '12px', marginBottom: '20px' }}>
            <div
              style={{
                fontSize: '14px',
                fontWeight: '700',
                color: '#002E56',
                marginLeft: '100px',
                marginBottom: '6px',
              }}
            >
              Inhalte der Schulung:
            </div>
            <ul
              style={{
                listStyle: 'none',
                padding: '0',
                margin: '0',
                marginLeft: '110px',
                fontSize: '13px',
                lineHeight: '1.7',
                color: '#1a1a1a',
              }}
            >
              <li>• Anwendung und Handling der Spirecut® Instrumente</li>
              <li>• Spezifikationen für KTS- und SF-Modelle</li>
              <li>• Sicherheit und optimaler Einsatz</li>
              <li>• Pflege und Wartung der Instrumente</li>
            </ul>
          </div>

          {/* Footer row */}
          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: '20px' }}>
            {/* Left: location and date */}
            <div
              style={{
                fontSize: '10px',
                fontWeight: '700',
                color: '#C9A227',
              }}
            >
              Aschheim, den 14. März 2026
            </div>

            {/* Right: signature */}
            <div style={{ textAlign: 'center', minWidth: '200px' }}>
              <img
                src="/__mockup/images/cert/signature-filesch.png"
                alt="Signature"
                style={{
                  maxHeight: '50px',
                  objectFit: 'contain',
                  marginBottom: '4px',
                }}
              />
              <div
                style={{
                  width: '100%',
                  height: '1px',
                  backgroundColor: '#002E56',
                  marginBottom: '4px',
                }}
              />
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: '700',
                  color: '#002E56',
                  lineHeight: '1.4',
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
