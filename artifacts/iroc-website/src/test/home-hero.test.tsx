/**
 * Tests for the Home page hero section and key translatable content areas.
 *
 * Heavy dependencies (API calls, TeamSection) are mocked so tests are
 * fast and self-contained. The focus is purely on DE ↔ EN text switching.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import Home from '@/pages/Home';

// ── mocks ─────────────────────────────────────────────────────────────────────

// TeamSection makes an API call — replace with a lightweight stub.
vi.mock('@/components/TeamSection', () => ({
  default: () => <section data-testid="team-section-stub" />,
}));

// useWebsiteSettings makes a fetch — return the default constants.
vi.mock('@/hooks/useWebsiteSettings', () => ({
  useWebsiteSettings: () => ({
    ws_contact_email: 'info@i-roc.de',
    ws_contact_phone: '+49 89 4625993 70',
    ws_contact_fax: '+49 89 21530 334',
    ws_address_street: 'St.-Emmeram-Str. 26',
    ws_address_postal: '85609',
    ws_address_city: 'Aschheim',
    ws_address_country_de: 'Deutschland',
    ws_address_country_en: 'Germany',
    ws_hero_image_url: '',
    ws_maps_embed_url: '',
    ws_maps_directions_url: '',
    ws_social_linkedin: '',
    ws_social_facebook: '',
    ws_social_instagram: '',
    ws_social_youtube: '',
  }),
}));

// wouter Link — render as a plain anchor.
vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
      <a href={href}>{children}</a>
    ),
  };
});

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => null,
  } as Response);
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

function renderHome() {
  return render(
    <LanguageProvider>
      <LanguageToggle />
      <Home />
    </LanguageProvider>,
  );
}

// ── Hero section ──────────────────────────────────────────────────────────────

describe('Home hero – language switching', () => {
  it('shows German hero headline "Orthopädische Lösungen" in DE mode', () => {
    renderHome();
    expect(screen.getByText('Orthopädische Lösungen')).toBeInTheDocument();
  });

  it('shows German hero sub-heading "Innovative & Regenerative" in DE mode', () => {
    renderHome();
    expect(screen.getByText('Innovative & Regenerative')).toBeInTheDocument();
  });

  it('switches hero headline to "Orthopedic Solutions" on EN', async () => {
    renderHome();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Orthopedic Solutions')).toBeInTheDocument();
    expect(screen.queryByText('Orthopädische Lösungen')).not.toBeInTheDocument();
  });

  it('shows German portfolio heading "Unser Portfolio" in DE mode', () => {
    renderHome();
    expect(screen.getByText('Unser Portfolio')).toBeInTheDocument();
  });

  it('switches portfolio heading to "Our Portfolio" on EN', async () => {
    renderHome();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Our Portfolio')).toBeInTheDocument();
    expect(screen.queryByText('Unser Portfolio')).not.toBeInTheDocument();
  });
});

// ── Treatment areas section ────────────────────────────────────────────────────

describe('Home treatment areas – language switching', () => {
  it('shows German section title "Behandlungsgebiete" in DE mode', () => {
    renderHome();
    expect(screen.getByText('Behandlungsgebiete')).toBeInTheDocument();
  });

  it('switches section title to "Areas of Expertise" on EN', async () => {
    renderHome();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Areas of Expertise')).toBeInTheDocument();
    expect(screen.queryByText('Behandlungsgebiete')).not.toBeInTheDocument();
  });

  it('shows German Spirecut indication "Karpal-Tunnel-Syndrom (KTS / CTS)" in DE mode', () => {
    renderHome();
    expect(screen.getByText('Karpal-Tunnel-Syndrom (KTS / CTS)')).toBeInTheDocument();
  });

  it('switches Spirecut indication to English on EN', async () => {
    renderHome();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Carpal Tunnel Syndrome (KTS / CTS)')).toBeInTheDocument();
    expect(screen.queryByText('Karpal-Tunnel-Syndrom (KTS / CTS)')).not.toBeInTheDocument();
  });
});

// ── "Doctors Training Doctors" section ────────────────────────────────────────

describe('Home Doctors Training Doctors section – language switching', () => {
  it('shows German "Unser Ansatz" label in DE mode', () => {
    renderHome();
    expect(screen.getByText('Unser Ansatz')).toBeInTheDocument();
  });

  it('switches "Unser Ansatz" → "Our Approach" on EN', async () => {
    renderHome();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Our Approach')).toBeInTheDocument();
    expect(screen.queryByText('Unser Ansatz')).not.toBeInTheDocument();
  });

  it('shows German value label "Hohe Qualität" in DE mode', () => {
    renderHome();
    expect(screen.getByText('Hohe Qualität')).toBeInTheDocument();
  });

  it('switches "Hohe Qualität" → "High Quality" on EN', async () => {
    renderHome();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('High Quality')).toBeInTheDocument();
    expect(screen.queryByText('Hohe Qualität')).not.toBeInTheDocument();
  });

  it('switches back to German when toggled back to DE', async () => {
    renderHome();
    const btn = screen.getByRole('button', { name: 'toggle-lang' });
    await userEvent.click(btn); // → EN
    await userEvent.click(btn); // → DE
    expect(screen.getByText('Orthopädische Lösungen')).toBeInTheDocument();
    expect(screen.queryByText('Orthopedic Solutions')).not.toBeInTheDocument();
  });
});
