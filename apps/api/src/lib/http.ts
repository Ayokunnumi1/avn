import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { AuthContext } from './auth-context';

/**
 * Typed route registry. Each route declares its Zod schemas once; the registry both
 * validates requests server-side and feeds the generated OpenAPI document, so the
 * documentation can never drift from the implementation.
 */
export interface Guard {
  describe: string;
  handler: RequestHandler;
}

export interface RouteMeta<B extends z.ZodTypeAny | undefined, Q extends z.ZodTypeAny | undefined> {
  summary: string;
  body?: B;
  query?: Q;
  guard?: Guard | Guard[];
  /** multipart/form-data upload (fields validated with `body`). */
  upload?: RequestHandler;
  rawBody?: boolean;
  public?: boolean;
  responses?: Record<number, string>;
}

export interface RouteDoc {
  method: string;
  path: string;
  tag: string;
  summary: string;
  auth: string;
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  multipart: boolean;
}
export const routeRegistry: RouteDoc[] = [];

export interface Ctx<B, Q> {
  body: B;
  query: Q;
  params: Record<string, string>;
  auth: AuthContext;
  ip: string;
  userAgent: string;
  requestId: string;
  files: Express.Multer.File[];
  file?: Express.Multer.File;
}

type Infer<T> = T extends z.ZodTypeAny ? z.infer<T> : undefined;
type Handler<B, Q> = (ctx: Ctx<B, Q>, req: Request, res: Response) => unknown | Promise<unknown>;

export function routes(prefix: string, tag: string) {
  const router = Router();

  function add<B extends z.ZodTypeAny | undefined = undefined, Q extends z.ZodTypeAny | undefined = undefined>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    meta: RouteMeta<B, Q>,
    handler: Handler<Infer<B>, Infer<Q>>,
  ) {
    const guards = meta.guard ? (Array.isArray(meta.guard) ? meta.guard : [meta.guard]) : [];
    routeRegistry.push({
      method,
      path: (prefix + path).replace(/:([a-zA-Z]+)/g, '{$1}'),
      tag,
      summary: meta.summary,
      auth: meta.public ? 'public' : guards.map((g) => g.describe).join(' + ') || 'authenticated',
      body: meta.body,
      query: meta.query,
      multipart: !!meta.upload,
    });

    const chain: RequestHandler[] = [...guards.map((g) => g.handler)];
    if (meta.upload) chain.push(meta.upload);
    chain.push(async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = meta.body ? meta.body.parse(req.body ?? {}) : undefined;
        const query = meta.query ? meta.query.parse(req.query ?? {}) : undefined;
        const files = Array.isArray(req.files) ? req.files : [];
        const ctx: Ctx<Infer<B>, Infer<Q>> = {
          body: body as Infer<B>,
          query: query as Infer<Q>,
          params: req.params as Record<string, string>,
          auth: req.auth,
          ip: req.ip ?? '',
          userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
          requestId: String((req as { id?: unknown }).id ?? ''),
          files,
          file: req.file,
        };
        const result = await handler(ctx, req, res);
        if (!res.headersSent) {
          if (result === undefined) res.status(res.statusCode === 200 ? 204 : res.statusCode).end();
          else res.json(result);
        }
      } catch (err) {
        next(err);
      }
    });
    router[method](path, ...chain);
  }

  return {
    router,
    prefix,
    get: <Q extends z.ZodTypeAny | undefined = undefined>(path: string, meta: RouteMeta<undefined, Q>, h: Handler<undefined, Infer<Q>>) =>
      add<undefined, Q>('get', path, meta, h),
    post: <B extends z.ZodTypeAny | undefined = undefined>(path: string, meta: RouteMeta<B, undefined>, h: Handler<Infer<B>, undefined>) =>
      add<B, undefined>('post', path, meta, h),
    put: <B extends z.ZodTypeAny | undefined = undefined>(path: string, meta: RouteMeta<B, undefined>, h: Handler<Infer<B>, undefined>) =>
      add<B, undefined>('put', path, meta, h),
    patch: <B extends z.ZodTypeAny | undefined = undefined>(path: string, meta: RouteMeta<B, undefined>, h: Handler<Infer<B>, undefined>) =>
      add<B, undefined>('patch', path, meta, h),
    delete: <B extends z.ZodTypeAny | undefined = undefined>(path: string, meta: RouteMeta<B, undefined>, h: Handler<Infer<B>, undefined>) =>
      add<B, undefined>('delete', path, meta, h),
  };
}

export const idParam = z.string().uuid();
export function uuidParam(ctx: { params: Record<string, string> }, name = 'id'): string {
  return idParam.parse(ctx.params[name]);
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
export const paged = <T>(items: T[], total: number, page: number, pageSize: number): Page<T> => ({ items, total, page, pageSize });
