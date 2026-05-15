/**
 * HTML Entity Escaping
 *
 * Escapes characters that have special meaning in HTML to prevent XSS
 * when interpolating user/AI-provided text into HTML output.
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const ESCAPE_RE = /[&<>"']/g;

export function escapeHtml(text: string): string {
  return text.replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch] ?? ch);
}
