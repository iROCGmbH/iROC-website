/**
 * Language-switching tests for product and training overview pages:
 *  – Spirecut® product page
 *  – MiniStem® product page
 *  – TrainingOverview page
 *
 * useVideoUrl is mocked to return null (video section renders nothing when
 * there is no URL), keeping tests fast and free of network calls.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import Spirecut from '@/pages/Spirecut';
import MiniStem from '@/pages/MiniStem';
import TrainingOverview from '@/pages/TrainingOverview';

// ── mocks ─────────────────────────────────────────────────────────────────────

// No video URL → video section skips rendering (returns null)
vi.mock('@/hooks/useVideoUrl', () => ({
  useVideoUrl: () => null,
}));

// wouter — render Link as a plain anchor
vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
      <a href={href}>{children}</a>
    ),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

// ── Spirecut® product page ────────────────────────────────────────────────────

describe('Spirecut page – language switching', () => {
  it('shows German badge "Minimalinvasive Chirurgie" in DE mode', () => {
    renderWithLang(<Spirecut />);
    expect(screen.getByText('Minimalinvasive Chirurgie')).toBeInTheDocument();
  });

  it('shows German CTA "Instrument bestellen" in DE mode', () => {
    renderWithLang(<Spirecut />);
    expect(screen.getByRole('link', { name: 'Instrument bestellen' })).toBeInTheDocument();
  });

  it('shows German CTA "Zur Schulung anmelden" in DE mode', () => {
    renderWithLang(<Spirecut />);
    expect(screen.getAllByRole('link', { name: 'Zur Schulung anmelden' }).length).toBeGreaterThan(0);
  });

  it('switches badge to "Minimally Invasive Surgery" on EN', async () => {
    renderWithLang(<Spirecut />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Minimally Invasive Surgery')).toBeInTheDocument();
    expect(screen.queryByText('Minimalinvasive Chirurgie')).not.toBeInTheDocument();
  });

  it('switches CTA to "Order Instrument" on EN', async () => {
    renderWithLang(<Spirecut />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByRole('link', { name: 'Order Instrument' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Instrument bestellen' })).not.toBeInTheDocument();
  });

  it('switches CTA to "Register for Training" on EN', async () => {
    renderWithLang(<Spirecut />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getAllByRole('link', { name: 'Register for Training' }).length).toBeGreaterThan(0);
  });

  it('switches back to German when toggled back to DE', async () => {
    renderWithLang(<Spirecut />);
    const btn = screen.getByRole('button', { name: 'toggle-lang' });
    await userEvent.click(btn); // → EN
    await userEvent.click(btn); // → DE
    expect(screen.getByText('Minimalinvasive Chirurgie')).toBeInTheDocument();
    expect(screen.queryByText('Minimally Invasive Surgery')).not.toBeInTheDocument();
  });
});

// ── MiniStem® product page ────────────────────────────────────────────────────

describe('MiniStem page – language switching', () => {
  it('shows German badge "Regenerative Medizin" in DE mode', () => {
    renderWithLang(<MiniStem />);
    expect(screen.getByText('Regenerative Medizin')).toBeInTheDocument();
  });

  it('shows German CTA "System bestellen" in DE mode', () => {
    renderWithLang(<MiniStem />);
    expect(screen.getByRole('link', { name: 'System bestellen' })).toBeInTheDocument();
  });

  it('switches badge to "Regenerative Medicine" on EN', async () => {
    renderWithLang(<MiniStem />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Regenerative Medicine')).toBeInTheDocument();
    expect(screen.queryByText('Regenerative Medizin')).not.toBeInTheDocument();
  });

  it('switches CTA to "Order System" on EN', async () => {
    renderWithLang(<MiniStem />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByRole('link', { name: 'Order System' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'System bestellen' })).not.toBeInTheDocument();
  });
});

// ── Training Overview page ────────────────────────────────────────────────────

describe('TrainingOverview page – language switching', () => {
  it('shows German heading "iROC Schulungsakademie" in DE mode', () => {
    renderWithLang(<TrainingOverview />);
    expect(
      screen.getByRole('heading', { name: 'iROC Schulungsakademie' }),
    ).toBeInTheDocument();
  });

  it('shows German card heading "Spirecut Zertifizierung" in DE mode', () => {
    renderWithLang(<TrainingOverview />);
    expect(screen.getByText('Spirecut Zertifizierung')).toBeInTheDocument();
  });

  it('shows German link "Termine & Anmeldung" in DE mode', () => {
    renderWithLang(<TrainingOverview />);
    // getAllByRole because there may be multiple matching links
    const links = screen.getAllByRole('link', { name: /Termine & Anmeldung/ });
    expect(links.length).toBeGreaterThan(0);
  });

  it('switches heading to "iROC Training Academy" on EN', async () => {
    renderWithLang(<TrainingOverview />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(
      screen.getByRole('heading', { name: 'iROC Training Academy' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'iROC Schulungsakademie' })).not.toBeInTheDocument();
  });

  it('switches card heading to "Spirecut Certification" on EN', async () => {
    renderWithLang(<TrainingOverview />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Spirecut Certification')).toBeInTheDocument();
    expect(screen.queryByText('Spirecut Zertifizierung')).not.toBeInTheDocument();
  });

  it('switches links to "Dates & Registration" on EN', async () => {
    renderWithLang(<TrainingOverview />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    const links = screen.getAllByRole('link', { name: /Dates & Registration/ });
    expect(links.length).toBeGreaterThan(0);
  });
});
