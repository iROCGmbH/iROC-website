import React from 'react';

export default function MiniStemDE() {
  return (
    <div className="min-h-screen w-full bg-[#F4F6F9] flex items-center justify-center py-8 font-sans">
      <div
        style={{ width: 1240, height: 877, boxShadow: '0 2px 24px rgba(0,112,192,0.08)' }}
        className="bg-[#FFFFFF] relative overflow-hidden flex flex-col shrink-0"
      >
        {/* Border */}
        <div className="absolute inset-[16px] border-[1.5px] border-[#0070C0] pointer-events-none z-10" />

        {/* Content Wrapper */}
        <div className="relative w-full h-full p-[48px] flex flex-col z-20">

          {/* Header Row */}
          <div className="flex justify-between items-end pb-3 border-b border-[#E2EEF8]">
            <img
              src="/__mockup/images/cert/logo-ministem-cert.png"
              alt="MiniStem Logo"
              className="max-h-[52px] object-contain"
            />
            <div className="flex flex-col items-center">
              <img
                src="/__mockup/images/cert/logo-iroc-cert.png"
                alt="iROC Logo"
                className="max-h-[42px] object-contain mb-1"
              />
              <div className="text-[#002E56] text-[6.5px] whitespace-pre text-center leading-[1.35]">
                {"Innovative    &    Regenerative\nmedical Oriented Consultation"}
              </div>
            </div>
          </div>

          {/* Accent Bar */}
          <div className="w-full h-[3px] bg-[#0070C0]" />

          {/* Title */}
          <div
            className="text-center text-[#0070C0] mt-[20px]"
            style={{ fontSize: 58, fontWeight: 300, letterSpacing: 14 }}
          >
            ZERTIFIKAT
          </div>

          {/* Divider */}
          <div className="w-full h-[1px] bg-[#D0E4F4] my-[20px]" />

          {/* Watermark */}
          <img
            src="/__mockup/images/cert/logo-iroc-cert.png"
            alt="Watermark"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] opacity-[0.04] pointer-events-none -z-10"
          />

          {/* Body Text */}
          <div className="text-center text-[#333] text-[13px] leading-[1.9] mt-[6px]">
            Hiermit wird bestätigt, dass
          </div>
          <div className="text-center text-[19px] font-semibold text-[#002E56] mt-[12px] mb-[8px]">
            Dr. med. Maria Müller, wohnhaft in München
          </div>
          <div className="text-center text-[#333] text-[13px] leading-[1.9]">
            am 14. März 2026 erfolgreich an der Schulung zum Thema:
          </div>

          {/* Course Title */}
          <div className="text-center text-[#002E56] text-[22px] font-semibold mt-4 mb-3">
            "MiniStem® Instrumente und Technik für MFAT"
          </div>

          <div className="text-center text-[#555] text-[13px]">
            durchgeführt von iROC GmbH in Aschheim teilgenommen hat.
          </div>

          {/* Bullets */}
          <div className="mt-6 w-full">
            <div className="text-[#0070C0] font-semibold mb-2 text-[15px] pl-[80px]">
              Inhalte der Schulung:
            </div>
            <div className="text-[#333] space-y-1 pl-[95px]" style={{ fontSize: 14, lineHeight: 1.75 }}>
              <div className="flex gap-2">
                <span className="text-[#0070C0]">•</span>
                <span>Anwendung und Handling der MiniStem® Instrumente</span>
              </div>
              <div className="flex gap-2">
                <span className="text-[#0070C0]">•</span>
                <span>Spezifikationen für MFAT Behandlung</span>
              </div>
              <div className="flex gap-2">
                <span className="text-[#0070C0]">•</span>
                <span>Sicherheit und optimaler Einsatz</span>
              </div>
              <div className="flex gap-2">
                <span className="text-[#0070C0]">•</span>
                <span>Pflege und Wartung der Instrumente</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-auto flex justify-between items-end pb-2 px-2">
            <div className="flex flex-col items-start w-[240px]">
              <div className="w-full h-[1px] bg-[#333] mb-1" />
              <div className="text-[#0070C0] text-[13px] font-bold w-full">
                Aschheim, den 14. März 2026
              </div>
            </div>

            <div className="w-[240px] flex flex-col items-center">
              <img
                src="/__mockup/images/cert/signature-blue.png"
                alt="Signature"
                className="max-h-[96px] mb-1 object-contain"
              />
              <div className="w-full h-[1px] bg-[#333] mb-1" />
              <div className="text-[#0070C0] text-[13px] font-bold w-full text-center">
                Dr. med Daniel A. Filesch, iROC GmbH
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
