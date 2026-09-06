import { describe, expect, it } from 'vitest';
import { isValidOptionalUrl } from '@/lib/url-utils';

describe('isValidOptionalUrl', () => {
  it('allows blank values because the URL field is optional', () => {
    expect(isValidOptionalUrl('')).toBe(true);
  });

  it('allows values containing only whitespace', () => {
    expect(isValidOptionalUrl(' \t\n ')).toBe(true);
  });

  it.each([
    'http://example.com',
    'http://example.com/path?source=test',
  ])('allows valid HTTP URLs: %s', (value) => {
    expect(isValidOptionalUrl(value)).toBe(true);
  });

  it.each([
    'https://example.com',
    'https://example.com/path?source=test',
  ])('allows valid HTTPS URLs: %s', (value) => {
    expect(isValidOptionalUrl(value)).toBe(true);
  });

  it.each(['example.com', 'not a URL', 'https://', 'http://[invalid-host'])(
    'rejects malformed values: %s',
    (value) => {
      expect(isValidOptionalUrl(value)).toBe(false);
    },
  );

  it.each(['ftp://example.com', 'javascript:alert(1)', 'data:text/plain,test'])(
    'rejects blocked protocols: %s',
    (value) => {
      expect(isValidOptionalUrl(value)).toBe(false);
    },
  );
});