const MAX_SERIALIZE_DEPTH = 4;
const MAX_SERIALIZE_ITEMS = 20;

export function formatConsoleArguments(values: unknown[]): string {
  try {
    return values.map((value) => formatValue(value, new WeakSet(), 0)).join(' ');
  } catch {
    return '[unserializable output]';
  }
}

function formatValue(value: unknown, seen: WeakSet<object>, depth: number): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `[Function${value.name ? `: ${value.name}` : ''}]`;

  if (value instanceof Error) return `${value.name || 'Error'}: ${value.message}`;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_SERIALIZE_DEPTH) return Array.isArray(value) ? '[Array]' : '[Object]';

  seen.add(value);
  if (Array.isArray(value)) {
    const parts = value
      .slice(0, MAX_SERIALIZE_ITEMS)
      .map((item) => formatValue(item, seen, depth + 1));
    if (value.length > MAX_SERIALIZE_ITEMS) parts.push('…');
    return `[${parts.join(', ')}]`;
  }

  try {
    const keys = Object.keys(value).slice(0, MAX_SERIALIZE_ITEMS);
    const parts = keys.map((key) => {
      try {
        return `${JSON.stringify(key)}: ${formatValue(
          (value as Record<string, unknown>)[key],
          seen,
          depth + 1,
        )}`;
      } catch {
        return `${JSON.stringify(key)}: [unavailable]`;
      }
    });
    if (Object.keys(value).length > MAX_SERIALIZE_ITEMS) parts.push('…');
    return `{${parts.join(', ')}}`;
  } catch {
    return '[unserializable object]';
  }
}
