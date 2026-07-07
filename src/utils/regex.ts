/**
 * Escape user input before embedding it in a RegExp (search params are
 * currently passed to `new RegExp(...)` verbatim — ReDoS / syntax-error risk).
 */
export const escapeRegExp = (input: string): string =>
  input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
