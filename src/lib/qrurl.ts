/** The text stored in the QR code. Works from any GitHub Pages address. */
export function scanUrl(listId: string, token: string): string {
  const base = window.location.origin + window.location.pathname;
  return `${base}#/scan/${listId}?k=${token}`;
}

/** The public sign-up page. The QR code and the shareable link are the same address. */
export function joinUrl(code: string): string {
  const base = window.location.origin + window.location.pathname;
  return `${base}#/join/${code}`;
}
