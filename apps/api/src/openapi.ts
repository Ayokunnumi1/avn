import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import { routeRegistry } from './lib/http';

const toSchema = (s: z.ZodTypeAny) => {
  const js = zodToJsonSchema(s, { $refStrategy: 'none', target: 'openApi3' }) as Record<string, unknown>;
  delete js.$schema;
  return js;
};

/** OpenAPI 3.0 document generated from the live route registry. */
export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routeRegistry) {
    const fullPath = `/api/v1${r.path}`;
    const params = [...fullPath.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const queryParams: unknown[] = [];
    if (r.query) {
      const qs = toSchema(r.query) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(qs.properties ?? {})) {
        queryParams.push({ name, in: 'query', required: qs.required?.includes(name) ?? false, schema });
      }
    }
    const op: Record<string, unknown> = {
      tags: [r.tag],
      summary: r.summary,
      description: `Authorisation: ${r.auth}`,
      parameters: [...params, ...queryParams],
      security: r.auth === 'public' ? [] : r.auth.startsWith('apiKey') ? [{ apiKey: [] }] : [{ sessionCookie: [] }],
      responses: {
        200: { description: 'Success' },
        400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        401: { description: 'Not authenticated' },
        403: { description: 'Forbidden' },
        404: { description: 'Not found' },
        409: { description: 'Conflict / illegal state transition' },
        429: { description: 'Rate limited' },
      },
    };
    if (r.body) {
      op.requestBody = {
        required: true,
        content: r.multipart ? { 'multipart/form-data': { schema: toSchema(r.body) } } : { 'application/json': { schema: toSchema(r.body) } },
      };
    } else if (r.multipart) {
      op.requestBody = { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } };
    }
    paths[fullPath] = { ...(paths[fullPath] ?? {}), [r.method]: op };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'AVN — Digital Address Verification Network API',
      version: '1.0.0',
      description:
        'Versioned REST API (/api/v1). Browser apps authenticate with an httpOnly session cookie plus the `X-AVN-App` header; ' +
        'institutions integrate with `Authorization: Bearer avn_live_…` API keys. Errors share the envelope `{ error: { code, message, details, requestId } }`.',
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'avn_<app>_session' },
        apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'avn_live_<prefix>.<secret>' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, requestId: { type: 'string' } } } },
        },
      },
    },
    paths,
  };
}
