/**
 * Language-switching tests for training registration pages:
 *  – SpirecutTraining
 *  – MiniStemTraining
 *
 * Both pages use the same form structure and API hooks, so mocks are
 * shared at file scope.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import SpirecutTraining from '@/pages/SpirecutTraining';
import MiniStemTraining from '@/pages/MiniStemTraining';

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@workspace/api-client-react', () => ({
  useGetTrainingDates: () => ({ data: [], isLoading: false }),
  useRegisterForTraining: () => ({ mutate: vi.fn(), isPending: false }),
  TrainingRegistrationInputInstrument: { spirecut: 'spirecut', ministem: 'ministem' },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/components/HumanCheck', () => ({
  useHumanCheck: () => ({ verified: false, reset: vi.fn() }),
  HumanCheckWidget: () => <div data-testid="human-check" />,
}));

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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <LanguageToggle />
        {ui}
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

// ── SpirecutTraining ──────────────────────────────────────────────────────────

describe('SpirecutTraining page – language switching', () => {
  it('shows German heading "Schulungsanmeldung" in DE mode', () => {
    renderWithLang(<SpirecutTraining />);
    expect(screen.getByText(/Schulungsanmeldung/)).toBeInTheDocument();
  });

  it('shows German label "Anrede" in DE mode', () => {
    renderWithLang(<SpirecutTraining />);
    expect(screen.getByText(/Anrede/)).toBeInTheDocument();
  });

  it('shows German label "Stornierungsbedingungen" in DE mode', () => {
    renderWithLang(<SpirecutTraining />);
    expect(screen.getByText('Stornierungsbedingungen')).toBeInTheDocument();
  });

  it('switches heading to "Training Registration" on EN', async () => {
    renderWithLang(<SpirecutTraining />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText(/Training Registration/)).toBeInTheDocument();
    expect(screen.queryByText(/Schulungsanmeldung/)).not.toBeInTheDocument();
  });

  it('switches label to "Salutation" on EN', async () => {
    renderWithLang(<SpirecutTraining />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText(/Salutation/)).toBeInTheDocument();
    expect(screen.queryByText(/^Anrede/)).not.toBeInTheDocument();
  });

  it('switches cancellation label to "Cancellation policy" on EN', async () => {
    renderWithLang(<SpirecutTraining />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Cancellation policy')).toBeInTheDocument();
    expect(screen.queryByText('Stornierungsbedingungen')).not.toBeInTheDocument();
  });

  it('switches the empty date state to English when no dates are available', async () => {
    renderWithLang(<SpirecutTraining />);
    await userEvent.click(screen.getByRole('button', { name: /Datum wählen/ }));
    expect(screen.getByText('Keine Termine verfügbar')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    await userEvent.click(screen.getByRole('button', { name: /Select date/ }));
    expect(screen.getByText('No dates available')).toBeInTheDocument();
    expect(screen.queryByText('Keine Termine verfügbar')).not.toBeInTheDocument();
  });

  it('switches back to German when toggled back to DE', async () => {
    renderWithLang(<SpirecutTraining />);
    const btn = screen.getByRole('button', { name: 'toggle-lang' });
    await userEvent.click(btn); // → EN
    await userEvent.click(btn); // → DE
    expect(screen.getByText(/Schulungsanmeldung/)).toBeInTheDocument();
    expect(screen.queryByText(/Training Registration/)).not.toBeInTheDocument();
  });
});

// ── MiniStemTraining ──────────────────────────────────────────────────────────

describe('MiniStemTraining page – language switching', () => {
  it('shows German heading "Schulungsanmeldung" in DE mode', () => {
    renderWithLang(<MiniStemTraining />);
    expect(screen.getByText(/Schulungsanmeldung/)).toBeInTheDocument();
  });

  it('shows German label "Anrede" in DE mode', () => {
    renderWithLang(<MiniStemTraining />);
    expect(screen.getByText(/Anrede/)).toBeInTheDocument();
  });

  it('switches heading to "Training Registration" on EN', async () => {
    renderWithLang(<MiniStemTraining />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText(/Training Registration/)).toBeInTheDocument();
    expect(screen.queryByText(/Schulungsanmeldung/)).not.toBeInTheDocument();
  });

  it('switches the empty date state to English when no dates are available', async () => {
    renderWithLang(<MiniStemTraining />);
    await userEvent.click(screen.getByRole('button', { name: /Datum wählen/ }));
    expect(screen.getByText('Keine Termine verfügbar')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    await userEvent.click(screen.getByRole('button', { name: /Select date/ }));
    expect(screen.getByText('No dates available')).toBeInTheDocument();
    expect(screen.queryByText('Keine Termine verfügbar')).not.toBeInTheDocument();
  });

  it('switches label to "Salutation" on EN', async () => {
    renderWithLang(<MiniStemTraining />);
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText(/Salutation/)).toBeInTheDocument();
    expect(screen.queryByText(/^Anrede/)).not.toBeInTheDocument();
  });

  it('switches back to German when toggled back to DE', async () => {
    renderWithLang(<MiniStemTraining />);
    const btn = screen.getByRole('button', { name: 'toggle-lang' });
    await userEvent.click(btn); // → EN
    await userEvent.click(btn); // → DE
    expect(screen.getByText(/Schulungsanmeldung/)).toBeInTheDocument();
  });
});
