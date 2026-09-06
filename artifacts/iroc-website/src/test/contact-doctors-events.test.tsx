/**
 * Language-switching tests for Contact, Doctors, and Events pages.
 *
 * All three make network calls; fetch is stubbed and API hooks are mocked
 * so tests are fully offline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import Contact from '@/pages/Contact';
import Doctors from '@/pages/Doctors';
import Events from '@/pages/Events';

// ── mocks ─────────────────────────────────────────────────────────────────────

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
    ws_maps_directions_url: 'https://maps.google.com/?q=test',
    ws_social_linkedin: '',
    ws_social_facebook: '',
    ws_social_instagram: '',
    ws_social_youtube: '',
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/components/HumanCheck', () => ({
  useHumanCheck: () => ({ verified: false, reset: vi.fn() }),
  HumanCheckWidget: () => <div data-testid="human-check" />,
}));

vi.mock('@workspace/api-client-react', () => ({
  useListTrainedDoctors: () => ({ data: [], isLoading: false }),
}));

// Suppress all network calls (Nominatim geocoding, events API, etc.)
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

function renderWithLang(ui: React.ReactElement) {
  return render(
    <LanguageProvider>
      <LanguageToggle />
      {ui}
    </LanguageProvider>,
  );
}

// ── Contact page ──────────────────────────────────────────────────────────────

describe('Contact page – language switching', () => {
  it('shows German heading "Nehmen Sie Kontakt auf" in DE mode', () => {
    renderWithLang(<Contact />);
    expect(screen.getByText('Nehmen Sie Kontakt auf')).toBeInTheDocument();
  });

  it('shows German label "Adresse" in DE mode', () => {
    renderWithLang(<Contact />);
    expect(screen.getByText('Adresse')).toBeInTheDocument();
  });

  it('shows German country "Deutschland" in DE mode', () => {
    renderWithLang(<Contact />);
    expect(screen.getByText(/Deutschland/)).toBeInTheDocument();
  });

  it('switches heading to "Get in touch" on EN', async () => {
    renderWithLang(<Contact />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Get in touch')).toBeInTheDocument();
    expect(screen.queryByText('Nehmen Sie Kontakt auf')).not.toBeInTheDocument();
  });

  it('switches address label to "Address" on EN', async () => {
    renderWithLang(<Contact />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Address')).toBeInTheDocument();
    expect(screen.queryByText('Adresse')).not.toBeInTheDocument();
  });

  it('switches country to "Germany" on EN', async () => {
    renderWithLang(<Contact />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText(/Germany/)).toBeInTheDocument();
    expect(screen.queryByText(/Deutschland/)).not.toBeInTheDocument();
  });

  it('switches back to German when toggled back to DE', async () => {
    renderWithLang(<Contact />);
    const btn = screen.getByRole('button', { name: 'toggle-lang' });
    await userEvent.click(btn); // → EN
    await userEvent.click(btn); // → DE
    expect(screen.getByText('Nehmen Sie Kontakt auf')).toBeInTheDocument();
    expect(screen.queryByText('Get in touch')).not.toBeInTheDocument();
  });
});

// ── Doctors page ──────────────────────────────────────────────────────────────

describe('Doctors page – language switching', () => {
  it('shows German heading "Zertifizierte Ärzte" in DE mode', () => {
    renderWithLang(<Doctors />);
    expect(screen.getByRole('heading', { name: 'Zertifizierte Ärzte' })).toBeInTheDocument();
  });

  it('switches heading to "Certified Doctors" on EN', async () => {
    renderWithLang(<Doctors />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByRole('heading', { name: 'Certified Doctors' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Zertifizierte Ärzte' })).not.toBeInTheDocument();
  });

  it('switches back to German when toggled back to DE', async () => {
    renderWithLang(<Doctors />);
    const btn = screen.getByRole('button', { name: 'toggle-lang' });
    await userEvent.click(btn); // → EN
    await userEvent.click(btn); // → DE
    expect(screen.getByRole('heading', { name: 'Zertifizierte Ärzte' })).toBeInTheDocument();
  });
});

// ── Events page ───────────────────────────────────────────────────────────────

describe('Events page – language switching', () => {
  // The fetch mock returns {ok: false}, so events === [] after the failed
  // fetch resolves — the "no events" empty state is shown.
  // But during the loading window (events === null) the skeleton is shown.
  // We verify the static heading which is rendered immediately.

  it('shows German heading "Kommende Veranstaltungen" in DE mode', () => {
    renderWithLang(<Events />);
    expect(screen.getByRole('heading', { name: 'Kommende Veranstaltungen' })).toBeInTheDocument();
  });

  it('shows German badge label "Veranstaltungen" in DE mode', () => {
    renderWithLang(<Events />);
    expect(screen.getByText('Veranstaltungen')).toBeInTheDocument();
  });

  it('switches heading to "Upcoming Events" on EN', async () => {
    renderWithLang(<Events />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByRole('heading', { name: 'Upcoming Events' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Kommende Veranstaltungen' })).not.toBeInTheDocument();
  });

  it('switches badge to "Events" on EN', async () => {
    renderWithLang(<Events />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    // "Events" appears in both DE ("Veranstaltungen" → badge was "Veranstaltungen") and EN
    // After toggling the badge should now be the EN string
    expect(screen.queryByText('Veranstaltungen')).not.toBeInTheDocument();
  });

  it('switches back to German when toggled back to DE', async () => {
    renderWithLang(<Events />);
    const btn = screen.getByRole('button', { name: 'toggle-lang' });
    await userEvent.click(btn); // → EN
    await userEvent.click(btn); // → DE
    expect(screen.getByRole('heading', { name: 'Kommende Veranstaltungen' })).toBeInTheDocument();
  });
});
