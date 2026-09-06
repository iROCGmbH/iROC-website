/**
 * Unit tests for LanguageContext — verifies that t() and tJSX() return the
 * correct translation after setLanguage() is called, and that the default
 * language is DE.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';

// ── helper ────────────────────────────────────────────────────────────────────

/**
 * Minimal component that exposes t() and tJSX() output through data-testid
 * elements, plus a button to toggle the language.
 */
function LanguageProbe() {
  const { t, tJSX, language, setLanguage } = useLanguage();
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="plain">{t('Hallo', 'Hello')}</span>
      <span data-testid="rich">{tJSX(<b>Fett</b>, <b>Bold</b>)}</span>
      <button onClick={() => setLanguage(language === 'DE' ? 'EN' : 'DE')}>
        toggle
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <LanguageProvider>
      <LanguageProbe />
    </LanguageProvider>,
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('LanguageContext', () => {
  it('defaults to DE on first render', () => {
    renderProbe();
    expect(screen.getByTestId('lang')).toHaveTextContent('DE');
  });

  it('t() returns the German string when language is DE', () => {
    renderProbe();
    expect(screen.getByTestId('plain')).toHaveTextContent('Hallo');
  });

  it('t() returns the English string after switching to EN', async () => {
    renderProbe();
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByTestId('plain')).toHaveTextContent('Hello');
  });

  it('tJSX() returns the German node when language is DE', () => {
    renderProbe();
    expect(screen.getByTestId('rich')).toHaveTextContent('Fett');
  });

  it('tJSX() returns the English node after switching to EN', async () => {
    renderProbe();
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByTestId('rich')).toHaveTextContent('Bold');
  });

  it('toggling back to DE shows German text again', async () => {
    renderProbe();
    const btn = screen.getByRole('button', { name: 'toggle' });
    await userEvent.click(btn); // → EN
    await userEvent.click(btn); // → DE
    expect(screen.getByTestId('plain')).toHaveTextContent('Hallo');
    expect(screen.getByTestId('lang')).toHaveTextContent('DE');
  });
});
