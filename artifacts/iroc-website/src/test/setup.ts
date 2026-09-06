import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';

// LanguageProvider reads localStorage on mount to restore the last-used language.
// Clear it before every test so that a test that toggles to EN does not bleed
// into the next test that expects DE as the default.
beforeEach(() => {
  localStorage.clear();
});
