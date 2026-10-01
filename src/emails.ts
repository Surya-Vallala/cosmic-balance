/** Looks like an email address (name@domain.tld). The server checks it properly. */
export function isEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
}
