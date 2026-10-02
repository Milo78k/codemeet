import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { once } from 'node:events';

import { createGraphQLYoga } from '../dist/graphql/yoga.js';
import { createApiServer } from '../dist/server.js';

const origins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
let server;
let graphqlUrl;

function expectOriginVary(response) {
  expect(
    response.headers
      .get('vary')
      ?.split(',')
      .map((value) => value.trim().toLowerCase()),
  ).toContain('origin');
}

function expectNoCors(response) {
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  expectOriginVary(response);
}

function postHealth(origin) {
  return fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(origin === undefined ? {} : { origin }),
    },
    body: JSON.stringify({ query: '{ health }' }),
  });
}

function preflight(origin) {
  return fetch(graphqlUrl, {
    method: 'OPTIONS',
    headers: {
      ...(origin === undefined ? {} : { origin }),
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type, authorization',
    },
  });
}

beforeAll(async () => {
  server = createApiServer({
    demoAuthEnabled: false,
    nodeEnv: 'test',
    allowedOrigins: origins,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  graphqlUrl = `http://127.0.0.1:${server.address().port}/graphql`;
});

afterAll(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
});

describe('explicit GraphQL CORS policy on the HTTP server', () => {
  test.each(origins)('allows POST from the configured origin %s', async (origin) => {
    const response = await postHealth(origin);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { health: 'ok' } });
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expectOriginVary(response);
  });

  test('allows the JSON POST preflight without authentication or PostgreSQL', async () => {
    const response = await preflight(origins[0]);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('access-control-allow-origin')).toBe(origins[0]);
    expect(response.headers.get('access-control-allow-methods')?.split(', ')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toBe(
      'content-type, authorization',
    );
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expectOriginVary(response);
  });

  test.each([
    'https://untrusted.example',
    'http://localhost:3001',
    'http://localhost:3000.untrusted.example',
    'null',
  ])('does not grant browser access to the origin %s', async (origin) => {
    const response = await postHealth(origin);
    // CORS controls browser access to the response; it is not authentication.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { health: 'ok' } });
    expectNoCors(response);
  });

  test('does not grant a denied preflight any CORS headers', async () => {
    const response = await preflight('https://untrusted.example');
    expect(response.status).toBe(204);
    expectNoCors(response);
    expect(response.headers.get('access-control-allow-methods')).toBeNull();
    expect(response.headers.get('access-control-allow-headers')).toBeNull();
  });

  test('preserves GraphQL requests without Origin for non-browser clients', async () => {
    const response = await postHealth();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { health: 'ok' } });
    expectNoCors(response);
  });

  test('handles OPTIONS without Origin without granting CORS access', async () => {
    const response = await preflight();
    expect(response.status).toBe(204);
    expectNoCors(response);
  });

  test('an empty allowlist grants no browser origin', async () => {
    const yoga = createGraphQLYoga({
      demoAuthEnabled: false,
      nodeEnv: 'test',
      allowedOrigins: [],
    });
    const response = await yoga.fetch('http://localhost/graphql', {
      method: 'OPTIONS',
      headers: { origin: origins[0], 'access-control-request-method': 'POST' },
    });
    expect(response.status).toBe(204);
    expectNoCors(response);
  });

  test('reads comma-separated explicit origins from environment', async () => {
    const previous = process.env.CORS_ALLOWED_ORIGINS;
    try {
      process.env.CORS_ALLOWED_ORIGINS = ' http://localhost:3000/ , http://127.0.0.1:3000 ';
      const yoga = createGraphQLYoga({ demoAuthEnabled: false, nodeEnv: 'test' });
      const response = await yoga.fetch('http://localhost/graphql', {
        method: 'OPTIONS',
        headers: { origin: origins[0], 'access-control-request-method': 'POST' },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(origins[0]);
      expectOriginVary(response);
    } finally {
      if (previous === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
      else process.env.CORS_ALLOWED_ORIGINS = previous;
    }
  });

  test.each([
    '*',
    'null',
    'https://*.example.com',
    'http://localhost:3000/graphql',
    'http://user:password@localhost:3000',
    'http://localhost:3000?query=1',
    'http://localhost:3000#fragment',
    'file:///tmp/web',
  ])('rejects unsafe or non-origin configuration %s', (origin) => {
    expect(() =>
      createGraphQLYoga({
        demoAuthEnabled: false,
        nodeEnv: 'test',
        allowedOrigins: [origin],
      }),
    ).toThrow('CORS_ALLOWED_ORIGINS must contain HTTP(S) origins');
  });
});
