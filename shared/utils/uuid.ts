/**
 * UUID v4 Generator
 *
 * Generates RFC 4122 compliant UUIDs without relying on crypto API.
 * Used for generating unique task IDs in environments without DOM.
 */

/**
 * Generates a UUID v4 string.
 * Uses Math.random() which is sufficient for non-cryptographic use cases.
 *
 * @returns UUID v4 string (e.g., '550e8400-e29b-41d4-a716-446655440000')
 */
export function generateUUID(): string {
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // where x is random hex digit, y is 8, 9, a, or b
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}