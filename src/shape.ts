/**
 * Coercion helpers for JSON that arrived from somewhere we do not control.
 *
 * None of the three catalogs publishes an API contract, so any field can be the wrong type on
 * any given day. These exist so a surprising shape degrades a single row rather than throwing
 * from whatever consumes the value three layers later - a non-string `description` throws inside
 * the search formatter, and a non-string `style_type` throws on `.split`.
 */

/** The value when it is a usable string, otherwise undefined. */
export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Only the string members of an array, or undefined when it is not an array with any. */
export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((v): v is string => typeof v === "string");
  return strings.length > 0 ? strings : undefined;
}
