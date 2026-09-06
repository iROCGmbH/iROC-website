/** Returns true when value is empty (allowed) or a syntactically valid http/https URL. */
export function isValidOptionalUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  try {
    const { protocol } = new URL(v);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}