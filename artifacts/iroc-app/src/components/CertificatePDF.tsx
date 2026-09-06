import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  PDFDownloadLink,
  type DocumentProps,
} from '@react-pdf/renderer';
import {
  formatCertDate,
  formatTrainingDateInfo,
  getAssetBase,
  type CertInstrument,
  type CertLang,
} from '@/lib/certificate-utils';

// ─── Language ─────────────────────────────────────────────────────────────────

export { formatCertDate, formatTrainingDateInfo, getAssetBase };
export type { CertInstrument, CertLang };

// ─── Certificate content per instrument × language ────────────────────────────

const CERT_CONTENT = {
  spirecut: {
    logoLeft: 'logo-spirecut-cert.png',
    de: {
      courseTitle: '"Spirecut® Instrumente und Technik für KTS und SF"',
      bullets: [
        'Anwendung und Handling der Spirecut® Instrumente',
        'Spezifikationen für KTS- und SF-Modelle',
        'Sicherheit und optimaler Einsatz',
        'Pflege und Wartung der Instrumente',
      ],
    },
    en: {
      courseTitle: '"Spirecut® Instruments and Technique for CTS and TF"',
      bullets: [
        'Application and handling of Spirecut® instruments',
        'Specifications for CTS and TF models',
        'Safety and optimal use',
        'Care and maintenance of instruments',
      ],
    },
  },
  ministem: {
    logoLeft: 'logo-ministem-cert.png',
    de: {
      courseTitle: '"MiniStem® Instrumente und Technik für MFAT"',
      bullets: [
        'Anwendung und Handling der MiniStem® Instrumente',
        'Spezifikationen für MFAT Behandlung',
        'Sicherheit und optimaler Einsatz',
        'Pflege und Wartung der Instrumente',
      ],
    },
    en: {
      courseTitle: '"MiniStem® Instruments and Technique for MFAT"',
      bullets: [
        'Application and handling of MiniStem® instruments',
        'Specifications for MFAT treatment',
        'Safety and optimal use',
        'Care and maintenance of instruments',
      ],
    },
  },
} as const;

// ─── Language strings ─────────────────────────────────────────────────────────

const STRINGS = {
  de: {
    docTitle:      (name: string) => `Zertifikat – ${name}`,
    certTitle:     'ZERTIFIKAT',
    intro:         (name: string, city: string) =>
      `Hiermit wird bestätigt, dass ${name}, wohnhaft in ${city}`,
    participation: (date: string) =>
      `am ${date} erfolgreich an der Schulung zum Thema:`,
    conducted:     'durchgeführt von iROC GmbH in Aschheim teilgenommen hat.',
    contentHeader: 'Inhalte der Schulung:',
    footerDate:    (loc: string, date: string) => `${loc}, den ${date}`,
    filePrefix:    'Zertifikat',
  },
  en: {
    docTitle:      (name: string) => `Certificate – ${name}`,
    certTitle:     'CERTIFICATE',
    intro:         (name: string, city: string) =>
      `This is to certify that ${name}, residing in ${city}`,
    participation: (date: string) =>
      `on ${date} successfully participated in the training:`,
    conducted:     'conducted by iROC GmbH in Aschheim.',
    contentHeader: 'Training contents:',
    footerDate:    (loc: string, date: string) => `${loc}, ${date}`,
    filePrefix:    'Certificate',
  },
} as const;

// ─── Formatting helpers ────────────────────────────────────────────────────────

function buildRecipientName(
  salutation: string | null,
  degree: string | null,
  first: string,
  last: string,
): string {
  return [salutation, degree, first, last].filter(Boolean).join(' ');
}

function buildFileName(
  parts: (string | null)[],
  instrument: string,
  lang: CertLang = 'de',
): string {
  const prefix = STRINGS[lang].filePrefix;
  return `${prefix}-${instrument}-${parts
    .filter(Boolean)
    .join('-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-äöüÄÖÜß]/g, '')}.pdf`;
}

// ─── Colours ──────────────────────────────────────────────────────────────────

const BLUE   = '#0070C0';
const NAVY   = '#002E56';
const GRAY   = '#333333';
const LGRAY  = '#555555';
const LBLUE  = '#D0E4F4';
const HBLUE  = '#E2EEF8';

// ─── PDF Styles — Clean Modern ────────────────────────────────────────────────
//
// Scale factor canvas→A4 landscape ≈ 0.677
// Canvas: 1240×877 px, 48 px content padding, 16 px border inset
// A4 landscape: 841×595 pt, 11 pt border inset, 33 pt inner padding
//
const s = StyleSheet.create({
  // A4 landscape, 11 pt padding so the blue border sits inset
  page: {
    backgroundColor: '#FFFFFF',
    padding: 11,
    fontFamily: 'Helvetica',
  },

  // Dark-navy border container
  outerBorder: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: NAVY,
    flexDirection: 'column',
    position: 'relative',
  },

  // Inner content area — all real content lives here
  inner: {
    flex: 1,
    paddingHorizontal: 33,
    paddingTop: 22,
    paddingBottom: 12,
    flexDirection: 'column',
  },

  // ── Watermark ──────────────────────────────────────────────────────────────
  watermarkWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.04,
  },
  watermark: {
    width: 203,
    height: 203,
    objectFit: 'contain',
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 7,
    borderBottomWidth: 1,
    borderBottomColor: HBLUE,
  },
  logoLeft: {
    height: 46,
    objectFit: 'contain',
    objectPositionX: 'left',
    maxWidth: 200,
  },
  // iROC block: logo left, right column (name + taglines) fills exact logo height
  irocBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  logoIroc: {
    height: 39,
    objectFit: 'contain',
    marginRight: 3,
  },
  irocRightCol: {
    height: 39,
    flexDirection: 'column',
    justifyContent: 'flex-start',
  },
  irocGmbhText: {
    fontSize: 10.75,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
  },
  taglineGroup: {
    flexDirection: 'column',
    marginTop: 5,
  },
  taglineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  taglineRowGap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 1.5,
  },
  tagline: {
    fontSize: 4.18,
    color: NAVY,
    lineHeight: 1.3,
  },
  taglineBold: {
    fontFamily: 'Helvetica-Bold',
  },

  // ── Accent bar ─────────────────────────────────────────────────────────────
  accentBar: {
    height: 2,
    backgroundColor: BLUE,
  },

  // ── Title ──────────────────────────────────────────────────────────────────
  titleWrap: {
    alignItems: 'center',
    marginTop: 13,
  },
  title: {
    fontSize: 39,
    color: BLUE,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 9,
  },

  // ── Thin divider below title ────────────────────────────────────────────────
  divider: {
    height: 1,
    backgroundColor: LBLUE,
    marginTop: 13,
    marginBottom: 13,
  },

  // ── Body text ──────────────────────────────────────────────────────────────
  bodyWrap: {
    alignItems: 'center',
    marginTop: 3,
  },
  bodyText: {
    fontSize: 11,
    color: GRAY,
    textAlign: 'center',
    lineHeight: 1.9,
  },
  recipientName: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    textAlign: 'center',
    marginTop: 7,
    marginBottom: 5,
  },
  courseTitle: {
    fontSize: 17,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    textAlign: 'center',
    marginTop: 7,
    marginBottom: 5,
  },
  conductedText: {
    fontSize: 11,
    color: LGRAY,
    textAlign: 'center',
  },

  // ── Bullets ────────────────────────────────────────────────────────────────
  bulletsWrap: {
    marginTop: 24,
    paddingLeft: 64,
  },
  bulletsHeader: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
    marginBottom: 4,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  bulletDot: {
    fontSize: 11.5,
    color: BLUE,
    marginRight: 5,
  },
  bulletText: {
    fontSize: 11.5,
    color: GRAY,
    lineHeight: 1.75,
  },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 'auto',
    paddingBottom: 3,
    paddingHorizontal: 3,
  },
  footerLeft: {
    width: 220,
    flexDirection: 'column',
  },
  footerLine: {
    height: 1,
    backgroundColor: GRAY,
    marginBottom: 3,
  },
  footerLeftText: {
    fontSize: 13.5,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
  },
  footerRight: {
    width: 163,
    alignItems: 'center',
    flexDirection: 'column',
  },
  signature: {
    height: 65,
    width: 225,
    objectFit: 'contain',
    marginBottom: 3,
  },
  footerRightText: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
    textAlign: 'center',
  },
});

// ─── Core PDF Document — Clean Modern ─────────────────────────────────────────

interface CertProps {
  salutation: string | null;
  medicalDegree: string | null;
  firstName: string;
  lastName: string;
  city: string | null;
  instrument: CertInstrument;
  trainingDateDisplay: string;
  footerDate: string;
  location?: string;
  assetBase: string;
  lang?: CertLang;
  svf?: boolean;
}

export function CertificateDocument({
  salutation,
  medicalDegree,
  firstName,
  lastName,
  city,
  instrument,
  trainingDateDisplay,
  footerDate,
  location = 'Aschheim',
  assetBase,
  lang = 'de',
  svf = false,
}: CertProps) {
  const certData      = CERT_CONTENT[instrument] ?? CERT_CONTENT.spirecut;
  const rawContent    = certData[lang];
  const applyMfatSvf  = svf && instrument === 'ministem';
  const content = applyMfatSvf
    ? {
        courseTitle: rawContent.courseTitle.replace(/MFAT/g, 'MFAT/SVF'),
        bullets: (rawContent.bullets as readonly string[]).map((b) => b.replace(/MFAT/g, 'MFAT/SVF')),
      }
    : rawContent;
  const str           = STRINGS[lang];
  const recipientName = buildRecipientName(salutation, medicalDegree, firstName, lastName);
  const recipientCity = city ?? '';

  return (
    <Document
      title={str.docTitle(recipientName)}
      author="iROC GmbH"
      creator="iROC Admin Portal"
    >
      <Page size="A4" orientation="landscape" style={s.page}>

        {/* ── Blue border container ── */}
        <View style={s.outerBorder}>

          {/* ── Watermark (absolute, behind all content) ── */}
          <View style={s.watermarkWrap}>
            <Image
              style={s.watermark}
              src={`${assetBase}logo-iroc-cert.png`}
            />
          </View>

          {/* ── All visible content ── */}
          <View style={s.inner}>

            {/* Header */}
            <View style={s.header}>
              <Image
                style={s.logoLeft}
                src={`${assetBase}${certData.logoLeft}`}
              />
              {/* iROC block: logo left · right column (name + taglines) fills exact logo height */}
              <View style={s.irocBlock}>
                <Image
                  style={s.logoIroc}
                  src={`${assetBase}logo-iroc-cert.png`}
                />
                {/* Right column — height matches logo; iROC GmbH at top, taglines pushed to bottom */}
                <View style={s.irocRightCol}>
                  <Text style={s.irocGmbhText}>iROC GmbH</Text>
                  {/* Tagline group — sits flush at bottom via space-between on parent */}
                  <View style={s.taglineGroup}>
                    <View style={s.taglineRow}>
                      <Text style={s.tagline}>
                        <Text style={s.taglineBold}>i</Text>nnovative
                      </Text>
                      <Text style={s.tagline}>&amp;</Text>
                      <Text style={s.tagline}>
                        <Text style={s.taglineBold}>R</Text>egenerative
                      </Text>
                    </View>
                    <View style={s.taglineRowGap}>
                      <Text style={s.tagline}>medical</Text>
                      <Text style={s.tagline}>
                        <Text style={s.taglineBold}>O</Text>riented
                      </Text>
                      <Text style={s.tagline}>
                        <Text style={s.taglineBold}>C</Text>onsultation
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>

            {/* Accent bar */}
            <View style={s.accentBar} />

            {/* Title */}
            <View style={s.titleWrap}>
              <Text style={s.title}>{str.certTitle}</Text>
            </View>

            {/* Thin divider */}
            <View style={s.divider} />

            {/* Body */}
            <View style={s.bodyWrap}>
              <Text style={s.bodyText}>
                {str.intro(recipientName, recipientCity)}
              </Text>
              <Text style={s.recipientName}>{recipientName}</Text>
              <Text style={s.bodyText}>
                {str.participation(trainingDateDisplay)}
              </Text>
              <Text style={s.courseTitle}>{content.courseTitle}</Text>
              <Text style={s.conductedText}>{str.conducted}</Text>
            </View>

            {/* Bullets */}
            <View style={s.bulletsWrap}>
              <Text style={s.bulletsHeader}>{str.contentHeader}</Text>
              {content.bullets.map((b, i) => (
                <View key={i} style={s.bulletRow}>
                  <Text style={s.bulletDot}>•</Text>
                  <Text style={s.bulletText}>{b}</Text>
                </View>
              ))}
            </View>

            {/* Footer */}
            <View style={s.footer}>

              {/* Left: location + date */}
              <View style={s.footerLeft}>
                <Text style={s.footerLeftText}>
                  {str.footerDate(location, footerDate)}
                </Text>
              </View>

              {/* Right: signature + name */}
              <View style={s.footerRight}>
                <Image
                  style={s.signature}
                  src={`${assetBase}signature-blue.png`}
                />
                <View style={[s.footerLine, { width: '100%' }]} />
                <Text style={s.footerRightText}>
                  Dr. med Daniel A. Filesch, iROC GmbH
                </Text>
              </View>

            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

// ─── Shared download-link renderer ────────────────────────────────────────────

function DownloadLink({
  doc,
  fileName,
  className,
  label,
}: {
  doc: React.ReactElement<DocumentProps>;
  fileName: string;
  className?: string;
  label?: string;
}) {
  const { lang } = useLanguage();
  return (
    <PDFDownloadLink document={doc} fileName={fileName} className={className}>
      {({ loading, error }) =>
        error ? (
          <span className="text-red-600 text-xs">{lang === 'de' ? 'Fehler' : 'Error'}</span>
        ) : loading ? (
          <span className="opacity-60">…</span>
        ) : (
          <span>{label ?? '⬇ PDF'}</span>
        )
      }
    </PDFDownloadLink>
  );
}

// ─── CertificatePicker — instrument + language + date + download ───────────────

interface PickerProps {
  salutation: string | null;
  medicalDegree: string | null;
  firstName: string;
  lastName: string;
  city: string | null;
  defaultInstrument: CertInstrument;
  trainingDateInfo: string | null;
  defaultCertDate: string;
  className?: string;
  hideDatePicker?: boolean;
}

export function CertificatePicker({
  salutation,
  medicalDegree,
  firstName,
  lastName,
  city,
  defaultInstrument,
  trainingDateInfo,
  defaultCertDate,
  className,
  hideDatePicker = false,
}: PickerProps) {
  const [instrument, setInstrument] = useState<CertInstrument>(defaultInstrument);
  const [certDate, setCertDate]     = useState(defaultCertDate);
  const [lang, setLang]             = useState<CertLang>('de');
  const [svf, setSvf]               = useState(false);

  const assetBase = getAssetBase();

  const trainingDateDE = formatTrainingDateInfo(trainingDateInfo, 'de') ?? formatCertDate(certDate, 'de');
  const trainingDateEN = formatTrainingDateInfo(trainingDateInfo, 'en') ?? formatCertDate(certDate, 'en');
  const trainingDateDisplay = lang === 'en' ? trainingDateEN : trainingDateDE;
  const footerDate          = formatCertDate(certDate, lang);

  const pdfDoc = (
    <CertificateDocument
      salutation={salutation}
      medicalDegree={medicalDegree}
      firstName={firstName}
      lastName={lastName}
      city={city}
      instrument={instrument}
      trainingDateDisplay={trainingDateDisplay}
      footerDate={footerDate}
      assetBase={assetBase}
      lang={lang}
      svf={svf}
    />
  );

  const fileName = buildFileName(
    [salutation, medicalDegree, firstName, lastName],
    instrument,
    lang,
  );

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>

      {/* Instrument toggle */}
      <div className="flex rounded-md overflow-hidden border border-input text-xs font-semibold shrink-0">
        <button
          type="button"
          onClick={() => setInstrument('spirecut')}
          className={`px-3 py-1.5 transition-colors ${
            instrument === 'spirecut'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-muted-foreground hover:bg-slate-50'
          }`}
        >
          Spirecut®
        </button>
        <button
          type="button"
          onClick={() => setInstrument('ministem')}
          className={`px-3 py-1.5 border-l border-input transition-colors ${
            instrument === 'ministem'
              ? 'bg-[#4a9c3c] text-white'
              : 'bg-white text-muted-foreground hover:bg-slate-50'
          }`}
        >
          MiniStem®
        </button>
      </div>

      {/* Language toggle */}
      <div className="flex rounded-md overflow-hidden border border-input text-xs font-semibold shrink-0">
        <button
          type="button"
          onClick={() => setLang('de')}
          className={`px-3 py-1.5 transition-colors ${
            lang === 'de'
              ? 'bg-slate-700 text-white'
              : 'bg-white text-muted-foreground hover:bg-slate-50'
          }`}
        >
          DE
        </button>
        <button
          type="button"
          onClick={() => setLang('en')}
          className={`px-3 py-1.5 border-l border-input transition-colors ${
            lang === 'en'
              ? 'bg-slate-700 text-white'
              : 'bg-white text-muted-foreground hover:bg-slate-50'
          }`}
        >
          EN
        </button>
      </div>

      {/* SVF checkbox — only for MiniStem® */}
      {instrument === 'ministem' && (
        <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none shrink-0">
          <input
            type="checkbox"
            checked={svf}
            onChange={(e) => setSvf(e.target.checked)}
            className="h-3.5 w-3.5 rounded accent-[#4a9c3c]"
          />
          + SVF
        </label>
      )}

      {/* Optional date picker */}
      {!hideDatePicker && (
        <input
          type="date"
          value={certDate}
          onChange={(e) => setCertDate(e.target.value)}
          className="h-8 px-2 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
      )}

      {/* Download */}
      <DownloadLink
        doc={pdfDoc}
        fileName={fileName}
        label={lang === 'en' ? '⬇ Certificate' : '⬇ Zertifikat'}
        className="inline-flex items-center gap-1.5 rounded-md bg-[#0070C0] hover:bg-[#005fa3] text-white text-xs font-semibold px-3 py-1.5 transition-colors shrink-0"
      />
    </div>
  );
}

// ─── DoctorCertButton — DE + EN download buttons per certification ─────────────

interface DoctorCertButtonProps {
  title: string | null;
  firstName: string;
  lastName: string;
  city: string;
  instrument: CertInstrument;
  certifiedDate: string;
}

export function DoctorCertButton({
  title,
  firstName,
  lastName,
  city,
  instrument,
  certifiedDate,
}: DoctorCertButtonProps) {
  const [svf, setSvf] = useState(false);

  const assetBase = getAssetBase();
  const dateDE    = formatCertDate(certifiedDate, 'de');
  const dateEN    = formatCertDate(certifiedDate, 'en');
  const label     = instrument === 'spirecut' ? 'Spirecut®' : 'MiniStem®';

  const makeDoc = (lang: CertLang) => (
    <CertificateDocument
      salutation={null}
      medicalDegree={title}
      firstName={firstName}
      lastName={lastName}
      city={city}
      instrument={instrument}
      trainingDateDisplay={lang === 'en' ? dateEN : dateDE}
      footerDate={lang === 'en' ? dateEN : dateDE}
      assetBase={assetBase}
      lang={lang}
      svf={svf}
    />
  );

  const btnClass =
    'inline-flex items-center gap-1 rounded bg-[#0070C0] hover:bg-[#005fa3] text-white text-xs font-semibold px-2.5 py-1 transition-colors';

  return (
    <div className="flex gap-1.5 flex-wrap items-center">
      {instrument === 'ministem' && (
        <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none">
          <input
            type="checkbox"
            checked={svf}
            onChange={(e) => setSvf(e.target.checked)}
            className="h-3.5 w-3.5 rounded accent-[#4a9c3c]"
          />
          + SVF
        </label>
      )}
      <DownloadLink
        doc={makeDoc('de')}
        fileName={buildFileName([title, firstName, lastName], instrument, 'de')}
        label={`⬇ ${label} DE`}
        className={btnClass}
      />
      <DownloadLink
        doc={makeDoc('en')}
        fileName={buildFileName([title, firstName, lastName], instrument, 'en')}
        label={`⬇ ${label} EN`}
        className={btnClass}
      />
    </div>
  );
}

// ─── Legacy CertificateDownloadButton (backward compat) ──────────────────────

interface LegacyDownloadBtnProps {
  salutation: string | null;
  medicalDegree: string | null;
  firstName: string;
  lastName: string;
  city: string | null;
  instrument: string;
  trainingDateInfo: string | null;
  certifiedDate: string;
  className?: string;
}

export function CertificateDownloadButton({
  salutation,
  medicalDegree,
  firstName,
  lastName,
  city,
  instrument,
  trainingDateInfo,
  certifiedDate,
  className,
}: LegacyDownloadBtnProps) {
  const assetBase = getAssetBase();
  const instr: CertInstrument = instrument === 'ministem' ? 'ministem' : 'spirecut';
  const dateDisplay = trainingDateInfo ?? formatCertDate(certifiedDate, 'de');
  const footerDate  = formatCertDate(certifiedDate, 'de');

  return (
    <DownloadLink
      doc={
        <CertificateDocument
          salutation={salutation}
          medicalDegree={medicalDegree}
          firstName={firstName}
          lastName={lastName}
          city={city}
          instrument={instr}
          trainingDateDisplay={dateDisplay}
          footerDate={footerDate}
          assetBase={assetBase}
          lang="de"
        />
      }
      fileName={buildFileName([salutation, medicalDegree, firstName, lastName], instr, 'de')}
      className={className}
      label="Zertifikat herunterladen"
    />
  );
}
