/** Optional paging preserves the legacy unpaged response and complete journal. */
export interface EventPageOptions { after: number; limit: number; }
export function optionalFlag(args: readonly string[], name: string): string | undefined {
  const indices = args.flatMap((value, index) => value === name ? [index] : []);
  if (indices.length === 0) return undefined;
  if (indices.length !== 1) throw new Error(name + " must be supplied only once.");
  const value = args[indices[0]! + 1];
  if (!value || value.startsWith("--")) throw new Error(name + " requires a value.");
  return value;
}
export function logPageOptions(args: readonly string[]): EventPageOptions | null {
  const after = optionalFlag(args, "--after");
  const limit = optionalFlag(args, "--limit");
  if (after === undefined && limit === undefined) return null;
  const integer = (value: string, name: string): number => {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new RangeError(name + " must be a non-negative safe integer.");
    }
    return Number(value);
  };
  const options = { after: integer(after ?? "0", "--after"), limit: integer(limit ?? "50", "--limit") };
  if (options.limit < 1 || options.limit > 500) throw new RangeError("--limit must be between 1 and 500.");
  return options;
}
export function selectEventPage<T extends { sequence: number }>(
  events: readonly T[], options: EventPageOptions,
): { events: T[]; nextAfter: number; hasMore: boolean } {
  if (!Number.isSafeInteger(options.after) || options.after < 0 ||
      !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500) {
    throw new RangeError("Invalid event page options.");
  }
  const selected: T[] = [];
  let previous = 0;
  let hasMore = false;
  for (const event of events) {
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= previous) {
      throw new Error("Event sequences must be positive, unique and increasing.");
    }
    previous = event.sequence;
    if (event.sequence <= options.after) continue;
    if (selected.length < options.limit) selected.push(event);
    else hasMore = true;
  }
  return { events: selected, nextAfter: selected.at(-1)?.sequence ?? options.after, hasMore };
}
