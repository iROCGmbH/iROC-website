/**
 * Tests for TeamSection — verifies that the category heading labels and
 * individual member role strings switch correctly when the language is toggled.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import TeamSection from '@/components/TeamSection';

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@workspace/api-client-react', () => ({
  useListTeamMembers: () => ({
    data: MOCK_MEMBERS,
  }),
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const MOCK_MEMBERS = [
  {
    id: 1,
    name: 'Dr. Anna Müller',
    category: 'consulting_doctors',
    role: 'Medical Director',
    roleDe: 'Ärztliche Direktorin',
    bio: 'Expert in orthopedics.',
    bioDe: 'Expertin für Orthopädie.',
    photoPath: null,
  },
  {
    id: 2,
    name: 'Hans Schmidt',
    category: 'specialists',
    role: 'Product Specialist',
    roleDe: 'Produktspezialist',
    bio: 'Specialist in medical devices.',
    bioDe: 'Spezialist für Medizinprodukte.',
    photoPath: null,
  },
  {
    id: 3,
    name: 'Sally',
    category: 'ai_agents',
    role: 'AI Sales Manager',
    roleDe: 'KI Vertriebsmanagerin',
    bio: null,
    bioDe: null,
    photoPath: null,
  },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  return (
    <button onClick={() => setLanguage(language === 'DE' ? 'EN' : 'DE')}>
      toggle-lang
    </button>
  );
}

function renderTeamSection() {
  return render(
    <LanguageProvider>
      <LanguageToggle />
      <TeamSection />
    </LanguageProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('TeamSection – language switching', () => {
  it('shows German category label "Beratende Mediziner" in DE mode', () => {
    renderTeamSection();
    expect(screen.getByText('Beratende Mediziner')).toBeInTheDocument();
  });

  it('shows German category label "Spezialisten" in DE mode', () => {
    renderTeamSection();
    expect(screen.getByText('Spezialisten')).toBeInTheDocument();
  });

  it('shows German member role in DE mode', () => {
    renderTeamSection();
    expect(screen.getByText('Ärztliche Direktorin')).toBeInTheDocument();
  });

  it('shows German team heading "Das iROC Team" in DE mode', () => {
    renderTeamSection();
    expect(screen.getByText('Das iROC Team')).toBeInTheDocument();
  });

  it('shows the independent advisory network heading and description in DE mode', () => {
    renderTeamSection();
    expect(screen.getByText('Unabhängiges Beratungsnetzwerk')).toBeInTheDocument();
    expect(screen.getByText(/Ein kollaborativer Kreis externer Ärztinnen/)).toBeInTheDocument();
  });

  it('shows the Agents/Managers heading and keeps those members in that section', () => {
    renderTeamSection();
    expect(screen.getByText('Agents/Managers')).toBeInTheDocument();
    expect(screen.getByText('Sally')).toBeInTheDocument();
  });

  it('switches to English category label "Consulting Medical Doctors" on EN', async () => {
    renderTeamSection();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Consulting Medical Doctors')).toBeInTheDocument();
    expect(screen.queryByText('Beratende Mediziner')).not.toBeInTheDocument();
  });

  it('switches to English category label "Specialists" on EN', async () => {
    renderTeamSection();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Specialists')).toBeInTheDocument();
    expect(screen.queryByText('Spezialisten')).not.toBeInTheDocument();
  });

  it('switches the new section headings and descriptions to English', async () => {
    renderTeamSection();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Independent Advisory Network')).toBeInTheDocument();
    expect(screen.getByText(/A collaborative circle of external physicians/)).toBeInTheDocument();
    expect(screen.getByText(/Our digital co-pilots and support systems/)).toBeInTheDocument();
  });

  it('switches to English member role on EN', async () => {
    renderTeamSection();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Medical Director')).toBeInTheDocument();
    expect(screen.queryByText('Ärztliche Direktorin')).not.toBeInTheDocument();
  });

  it('switches back to German labels when toggled back to DE', async () => {
    renderTeamSection();
    const btn = screen.getByRole('button', { name: 'toggle-lang' });
    await userEvent.click(btn); // → EN
    await userEvent.click(btn); // → DE
    expect(screen.getByText('Beratende Mediziner')).toBeInTheDocument();
    expect(screen.queryByText('Consulting Medical Doctors')).not.toBeInTheDocument();
  });
});
