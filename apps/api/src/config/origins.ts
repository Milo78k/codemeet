export function parseAllowedOrigins(values: readonly string[]): Set<string> {
  const origins = new Set<string>();
  const message =
    'CORS_ALLOWED_ORIGINS must contain HTTP(S) origins without wildcards, credentials, paths, query strings, or fragments.';

  for (const value of values) {
    const origin = value.trim();
    if (!origin) continue;

    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(message);
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      origin.includes('*') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error(message);
    }
    origins.add(url.origin);
  }

  return origins;
}
