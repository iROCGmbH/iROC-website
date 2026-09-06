/**
 * Language-switching tests for static content-only pages:
 *  – Agb (General Terms & Conditions)
 *  – Impressum (Legal Notice)
 *
 * Neither page makes API calls, so no module mocks are required beyond
 * wrapping in LanguageProvider.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import Agb from '@/pages/Agb';
import Impressum from '@/pages/Impressum';

// ── helpers ───────────────────────────────────────────────────────────────────

function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  return (
    <button onClick={() => setLanguage(language === 'DE' ? 'EN' : 'DE')}>
      toggle-lang
    </button>
  );
}

function renderWithLang(ui: React.ReactElement) {
  return render(
    <LanguageProvider>
      <LanguageToggle />
      {ui}
    </LanguageProvider>,
  );
}

function CmsOverrides() {
  const { setCmsMap } = useLanguage();

  useEffect(() => {
    setCmsMap(new Map([
      [
        'iROC GmbH\nInnovative & Regenerative medical Oriented Consultation\nSt.-Emmeram-Str. 26\n85609 Aschheim\nDeutschland',
        { de: 'CMS Firmenadresse', en: 'CMS company address' },
      ],
      [
        'Telefon: +49 89 4625993 70\nFax: +49 89 21530 334\nE-Mail: info@i-roc.de\nWeb: https://i-roc.de',
        { de: 'CMS Kontakt DE', en: 'CMS contact EN' },
      ],
    ]));
  }, [setCmsMap]);

  return null;
}

function renderWithCmsOverrides(ui: React.ReactElement) {
  return render(
    <LanguageProvider>
      <LanguageToggle />
      <CmsOverrides />
      {ui}
    </LanguageProvider>,
  );
}

function AgbCmsOverrides() {
  const { setCmsMap } = useLanguage();

  useEffect(() => {
    setCmsMap(new Map([
      ['6. Keine Rücknahmeverpflichtung', { de: 'CMS Rücknahme DE', en: 'CMS repurchase EN' }],
      ['Der Kunde darf die Ware nicht an Dritte, einschließlich anderer Unternehmen oder gewerblicher Einrichtungen, weiterveräußern, sofern nicht zuvor die schriftliche Zustimmung der iROC GmbH erteilt wurde.', { de: 'CMS Weiterverkauf DE', en: 'CMS resale EN' }],
    ]));
  }, [setCmsMap]);

  return null;
}

function renderAgbWithCmsOverrides() {
  return render(
    <LanguageProvider>
      <LanguageToggle />
      <AgbCmsOverrides />
      <Agb />
    </LanguageProvider>,
  );
}

// ── Agb ───────────────────────────────────────────────────────────────────────

describe('Agb – language switching', () => {
  it('shows German heading "Allgemeine Verkaufsbedingungen" in DE mode', () => {
    renderWithLang(<Agb />);
    expect(
      screen.getByText(/Allgemeine Verkaufsbedingungen \(AVB\)/),
    ).toBeInTheDocument();
  });

  it('shows German section heading "1. Geltung und Anwendungsbereich" in DE mode', () => {
    renderWithLang(<Agb />);
    expect(screen.getByText(/Geltung und Anwendungsbereich/)).toBeInTheDocument();
  });

  it('switches main heading to "General Terms and Conditions of Sale" on EN', async () => {
    renderWithLang(<Agb />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(
      screen.getByText(/General Terms and Conditions of Sale \(GTC\)/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Allgemeine Verkaufsbedingungen/),
    ).not.toBeInTheDocument();
  });

  it('switches section heading to "1. Scope and Applicability" on EN', async () => {
    renderWithLang(<Agb />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText(/Scope and Applicability/)).toBeInTheDocument();
    expect(screen.queryByText(/Geltung und Anwendungsbereich/)).not.toBeInTheDocument();
  });

  it('switches back to German when toggled back to DE', async () => {
    renderWithLang(<Agb />);
    const btn = screen.getByRole('button', { name: 'toggle-lang' });
    await userEvent.click(btn); // → EN
    await userEvent.click(btn); // → DE
    expect(screen.getByText(/Allgemeine Verkaufsbedingungen/)).toBeInTheDocument();
    expect(screen.queryByText(/General Terms and Conditions of Sale/)).not.toBeInTheDocument();
  });

  it('renders the renumbered source sections in order and normalizes net prices to 3.1', () => {
    renderWithLang(<Agb />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      '1. Geltung und Anwendungsbereich',
      '2. Vertragsschluss und Bestellungen',
      '3. Preise und Zahlungsbedingungen',
      '4. Lieferung, Lieferfristen und Gefahrübergang',
      '5. Eigentumsvorbehalt',
      '6. Keine Rücknahmeverpflichtung',
      '7. Gewährleistung und Mängelrüge',
      '8. Haftung und Schadensersatz',
      '9. Erfüllungsort, Gerichtsstand und anwendbares Recht',
      '10. Salvatorische Klausel',
    ]);
    expect(screen.getByText('3.1. Nettopreise:', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('4.1. Nettopreise:', { exact: true })).not.toBeInTheDocument();
  });

  it('uses bilingual CMS overrides for the revised repurchase and resale clauses', async () => {
    renderAgbWithCmsOverrides();
    expect(await screen.findByText('CMS Rücknahme DE')).toBeInTheDocument();
    expect(screen.getByText('CMS Weiterverkauf DE')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('CMS repurchase EN')).toBeInTheDocument();
    expect(screen.getByText('CMS resale EN')).toBeInTheDocument();
  });
});

// ── Impressum ─────────────────────────────────────────────────────────────────

describe('Impressum – language switching', () => {
  it('shows German heading "Impressum" in DE mode', () => {
    renderWithLang(<Impressum />);
    expect(screen.getByRole('heading', { name: 'Impressum' })).toBeInTheDocument();
  });

  it('shows German section "Angaben gemäß § 5 TMG" in DE mode', () => {
    renderWithLang(<Impressum />);
    expect(screen.getByText(/Angaben gemäß § 5 TMG/)).toBeInTheDocument();
  });

  it('shows German "Geschäftsführung" heading in DE mode', () => {
    renderWithLang(<Impressum />);
    expect(screen.getByText('Geschäftsführung')).toBeInTheDocument();
  });

  it('switches heading to "Legal Notice" on EN', async () => {
    renderWithLang(<Impressum />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByRole('heading', { name: 'Legal Notice' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Impressum' })).not.toBeInTheDocument();
  });

  it('switches section to "Company Information (§ 5 TMG)" on EN', async () => {
    renderWithLang(<Impressum />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText(/Company Information \(§ 5 TMG\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Angaben gemäß § 5 TMG/)).not.toBeInTheDocument();
  });

  it('switches "Geschäftsführung" → "Managing Directors" on EN', async () => {
    renderWithLang(<Impressum />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Managing Directors')).toBeInTheDocument();
    expect(screen.queryByText('Geschäftsführung')).not.toBeInTheDocument();
  });

  it('renders company and contact details from the shared CMS entries in both languages', async () => {
    renderWithCmsOverrides(<Impressum />);

    expect(await screen.findByText('CMS Firmenadresse')).toBeInTheDocument();
    expect(screen.getByText('CMS Kontakt DE')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('CMS company address')).toBeInTheDocument();
    expect(screen.getByText('CMS contact EN')).toBeInTheDocument();
  });
});
