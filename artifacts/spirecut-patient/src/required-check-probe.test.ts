import { describe, expect, it } from 'vitest';

describe('protected Spirecut check probe', () => {
  it('blocks merge while the required check fails', () => {
    expect('required check').toBe('successful check');
  });
});
