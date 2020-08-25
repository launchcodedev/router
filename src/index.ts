/* eslint-disable import/no-dynamic-require, global-require, no-throw-literal, no-ex-assign */
import Router from 'koa-router';
import fs from 'fs-extra';
import Ajv from 'ajv';
import YAML from 'js-yaml';
import * as yup from 'yup';
import { join } from 'path';
import { merge } from 'lodash';
import { parse as parseStackTrace } from 'stacktrace-parser';
import resolveFrom from 'resolve-from';
import bodyparser from 'koa-bodyparser';
import { parse as parsePathString } from 'path-to-regexp';
import { SchemaBuilder, JsonSchemaType } from '@serafin/schema-builder';
import { Extraction, extract } from '@lcdev/mapper';
import { Json } from '@lcdev/ts';
import { extractJsonSchema } from '@lcdev/api-fields';
// this module actually has no js, so eslint fails to resolve it
// eslint-disable-next-line import/no-unresolved
import * as OpenAPI from '@serafin/open-api';

export * from '@lcdev/api-fields';
export * from './pagination';

export { bodyparser };
export { Router };
export { SchemaBuilder } from '@serafin/schema-builder';
export const { emptySchema } = SchemaBuilder;

export const nullSchema = SchemaBuilder.fromJsonSchema({ type: 'null' } as const);

export const integerString = <N extends boolean = false>(
  schema?: Omit<ArgumentTypes<typeof SchemaBuilder.stringSchema>[0], 'pattern'>,
  nullable?: N,
) => SchemaBuilder.stringSchema<N>({ ...schema, pattern: '^\\d+$' }, nullable);

type ArgumentTypes<T> = T extends (...args: infer U) => unknown ? U : never;
type ReturnType<T> = T extends (...args: any) => infer R ? R : never;
type ReplaceReturnType<T, R extends ReturnType<T>> = (...a: ArgumentTypes<T>) => R;
type AddContext<T, TContext> = (this: TContext, ...a: ArgumentTypes<T>) => ReturnType<T>;

export type Middleware = Router.IMiddleware;
export type Context = Router.IRouterContext;
export type Next = ArgumentTypes<Middleware>[1];

export class BaseError extends Error {
  code: number = 0;

  message: string = 'Something went wrong';

  statusCode: number = 500;

  data?: Json;

  constructor(message: string, code: number = 500, statusCode: number = code) {
    super(message);

    this.message = message;
    this.code = code;
    this.statusCode = statusCode;
  }

  withData(data: Json) {
    this.data = data;
    return this;
  }

  static from(err: Error, code?: number, statusCode?: number) {
    return new BaseError(err.message || err.toString(), code, statusCode);
  }
}

export const err = (status: number, msg: string, code = -1) => {
  return new BaseError(msg, code, status);
};

export enum HttpMethod {
  GET = 'get',
  POST = 'post',
  PUT = 'put',
  PATCH = 'patch',
  DELETE = 'delete',
  HEAD = 'head',
  OPTIONS = 'options',

  // special value that binds to all http methods
  all = 'all',
}

export interface Schema {
  validate: (body: any) => Promise<true | Error>;
}

export class JSONSchema<T> implements Schema {
  readonly ajvValidate: Ajv.ValidateFunction;

  readonly raw: object;

  constructor(private readonly builder: SchemaBuilder<T>) {
    this.raw = builder.schema;

    this.ajvValidate = new Ajv().compile({
      // default to draft 7, but of course the schema can just overwrite this
      $schema: 'http://json-schema.org/draft-07/schema#',
      ...this.raw,
    });
  }

  static build<T>(cb: (builder: typeof SchemaBuilder) => SchemaBuilder<T>) {
    return new JSONSchema(cb(SchemaBuilder));
  }

  static raw<S>(schema: S): JSONSchema<JsonSchemaType<S>> {
    return new JSONSchema(SchemaBuilder.fromJsonSchema(schema));
  }

  static load(schemaName: string, schemaDir: string) {
    const path = resolveFrom(schemaDir, `./${schemaName}.json`);

    return JSONSchema.raw(require(path));
  }

  static loadYaml(schemaName: string, schemaDir: string, ext = 'yml') {
    const path = resolveFrom(schemaDir, `./${schemaName}.${ext}`);
    const contents = fs.readFileSync(path);
    return JSONSchema.raw(YAML.safeLoad(contents.toString('utf8')));
  }

  validate = async (body: any) => {
    const valid = this.ajvValidate(body);

    if (valid) {
      return true;
    }

    const err =
      this.ajvValidate.errors &&
      this.ajvValidate.errors
        .map(({ dataPath, message, params }) => {
          if ('additionalProperty' in params) {
            return `${message}: ${params.additionalProperty}`;
          }

          return `${dataPath}: ${message}`;
        })
        .join(', ');

    return new BaseError(`validation error: [${err}]`, 400);
  };
}

export class YupSchema<T> implements Schema {
  constructor(public readonly raw: yup.Schema<T>) {}

  static create<T>(callback: (y: typeof yup) => yup.Schema<T>) {
    return new YupSchema<T>(callback(yup));
  }

  validate = async (body: any) => {
    try {
      await this.raw.validate(body);

      return true;
    } catch ({ errors }) {
      const err = errors.join(', ');

      return new BaseError(`validation error: [${err}]`, 400);
    }
  };
}

export type RouteActionResponse = Promise<object | string | number | boolean | void>;
export type RouteAction = ReplaceReturnType<Middleware, RouteActionResponse>;
export type RouteActionWithContext<T> = AddContext<RouteAction, T>;

export interface RouteFactory<T> {
  readonly prefix?: string;
  getDependencies: () => Promise<T> | T;
  create: (dependencies: T) => Promise<Route[]> | Route[];
  middleware?: (dependencies: T) => Promise<Middleware[]> | Middleware[];
  nested?: (dependencies: T) => Promise<RouteFactory<any>[]> | RouteFactory<any>[];
}

export interface RouteWithContext<Ctx> {
  path: string | string[];
  docs?: OpenAPI.OperationObject & {
    // we override this to enforce non-invalid responses objects
    responses: { [statusCode: number]: OpenAPI.ResponseObject };
  };
  method: HttpMethod | HttpMethod[];
  schema?: Schema;
  querySchema?: Schema;
  returning?: Extraction;
  action: RouteActionWithContext<Ctx>;
  middleware?: Middleware[] | (() => Middleware[]);
}

export type Route = RouteWithContext<any>;

type MadeRoute = Route & {
  middleware?: Middleware[];
  routerMiddleware?: Middleware[];
};

/** @deprecated use `route` instead */
export const routeWithBody = route;

/**
 * Constructs a type safe route action, useable in {@link RouteFactory#create}. Is better than plain
 * objects because it enables you to infer the body and query types.
 */
export function route<Ctx, Body = never, Query = never>(
  route: Omit<RouteWithContext<Ctx>, 'action' | 'schema' | 'querySchema'> & {
    schema?: SchemaBuilder<Body> | JSONSchema<Body>;
    querySchema?: SchemaBuilder<Query> | JSONSchema<Query>;
    action: (this: Ctx, ctx: Context, body: Body, query: Query, next: Next) => RouteActionResponse;
  },
): RouteWithContext<Ctx> {
  let schema;
  let querySchema;

  if (route.schema) {
    schema = route.schema instanceof JSONSchema ? route.schema : new JSONSchema(route.schema);
  }

  if (route.querySchema) {
    querySchema =
      route.querySchema instanceof JSONSchema
        ? route.querySchema
        : new JSONSchema(route.querySchema);
  }

  return {
    ...route,
    schema,
    querySchema,
    async action(ctx, next) {
      return route.action.call(this, ctx, ctx.request.body, ctx.query, next);
    },
  };
}

/**
 * Helper to create a router that nests all factories in a prefix. Is easily done manually using
 * `nested` property of a factory.
 *
 * Typical use:
 *
 * ```
 * const api = nestedRouter(join(__dirname, 'routes'), '/api');
 * const router = await createRouterFactories([api]);
 * ```
 */
export const nestedRouter = (dirname: string, prefix?: string): RouteFactory<void> => {
  return {
    prefix,
    nested: () => findRouters(dirname),

    getDependencies() {},
    create() {
      return [];
    },
  };
};

/**
 * Binds a `this` context to all routes given, typically used in a {@link RouteFactory#create} function.
 */
export const bindRouteActions = <Ctx>(c: Ctx, routes: RouteWithContext<Ctx>[]): Route[] => {
  return routes.map(route => ({
    ...route,
    action: route.action.bind(c as any),
  }));
};

/**
 * Consumes one route factory and produces the routes that it creates.
 */
export const createRoutes = async <D>(factory: RouteFactory<D>, deps: D): Promise<MadeRoute[]> => {
  const routes: (Route | MadeRoute)[] = await factory.create(deps);

  let routerMiddleware: Middleware[] | undefined;

  if (factory.middleware) {
    routerMiddleware = await factory.middleware(deps);
  }

  if (factory.nested) {
    const nested = await factory.nested(deps);

    // NOTE: dependencies cannot be injected here, which may be difficult for testing
    routes.push(...(await createAllRoutes(nested)));
  }

  type FlatRoute = (Route | MadeRoute) & { path: string };

  const flatRoutes = routes.reduce((routes, route) => {
    if (Array.isArray(route.path)) {
      return routes.concat(
        route.path.map(path => ({
          ...route,
          path,
        })),
      );
    }

    return routes.concat(route as FlatRoute);
  }, [] as FlatRoute[]);

  return flatRoutes.map<MadeRoute>(route => {
    const path = join(factory.prefix ?? '', route.path);
    // eslint-disable-next-line
    const middleware = route.middleware
      ? typeof route.middleware === 'function'
        ? route.middleware()
        : route.middleware
      : [];

    return {
      ...route,
      // add the prefix of the router to each Route
      path,
      middleware,
      routerMiddleware: [
        ...(routerMiddleware ?? []),
        ...((route as MadeRoute).routerMiddleware ?? []),
      ],
    };
  });
};

/**
 * Consumes route factories and produces the routes that they create, using default `getDependencies`.
 */
export const createAllRoutes = async (factories: RouteFactory<any>[]): Promise<MadeRoute[]> => {
  // inject dependencies
  const routerRoutes = await Promise.all(
    factories.map(async factory => {
      return createRoutes(factory, await factory.getDependencies());
    }),
  );

  // flatten all routes
  return routerRoutes.reduce<MadeRoute[]>((acc, routes) => acc.concat(routes), []);
};

/**
 * Helper for loading all modules in a folder as plain RouteFactories (does not instantiate them).
 */
export const findRouters = async (dir: string): Promise<RouteFactory<any>[]> =>
  (await fs.readdir(dir))
    .filter(n => /\.(j|t)sx?$/.exec(n))
    .filter(n => !/\.d\.ts$/.exec(n))
    .filter(n => !/\.test\..*$/.exec(n))
    .filter(n => !/^index\./.exec(n))
    .map(filename => readRouterFile(join(dir, filename)));

/**
 * Helper for loading module from a file as plain RouteFactories (does not instantiate it).
 */
export const readRouterFile = (filename: string): RouteFactory<any> => {
  const {
    default: factory,
  }: {
    default: RouteFactory<any>;
  } = require(filename);

  if (!factory) throw new Error(`missing default export: ${filename}`);

  // we account for 'export default class implements RouteFactory' here by calling `new`
  if (!factory.create) {
    const FactoryClass = (factory as any) as new () => RouteFactory<any>;
    return new FactoryClass();
  }

  return factory;
};

/**
 * Creates a full Router out of all routes formed by router factories.
 * Is usually not used externally - you'd rather use {@link createRouterFactories} or {@link createRouter}.
 */
export const createRouterRaw = async (routes: MadeRoute[], debug = false): Promise<Router> => {
  const router = new Router();

  if (debug) {
    console.log('Mounting routes...');
  }

  // Call router.get(), router.post(), router.put(), etc, to set up routes
  routes.forEach(route => {
    const { path, method } = route;

    const methods = Array.isArray(method) ? method : [method];

    if (debug) {
      console.log(`\t[${methods.map(m => m.toUpperCase()).join(', ')}] ${path}`);
    }

    addRouteToRouter(route, router);
  });

  return router;
};

/**
 * Creates a full Router out of all RouterFactory modules (see {@link createRouter} to automatically load a folder).
 */
export const createRouterFactories = async (
  factories: RouteFactory<any>[],
  debug = false,
): Promise<Router> => {
  const routes = await createAllRoutes(factories);
  return createRouterRaw(routes, debug);
};

/**
 * Creates a full Router out of all RouterFactory modules in a folder.
 */
export const createRouter = async (dir: string, debug = false): Promise<Router> => {
  const routes = await createAllRoutes(await findRouters(dir));
  return createRouterRaw(routes, debug);
};

/**
 * Generates an OpenAPI spec for your router(s).
 */
export const createOpenAPI = (
  routes: MadeRoute[],
  meta: { info: OpenAPI.InfoObject; servers?: OpenAPI.ServerObject[] },
) => {
  const paths: OpenAPI.PathObject = {};

  const openAPI: OpenAPI.OpenAPIObject = {
    openapi: '3.0.0',
    info: meta.info,
    servers: meta.servers ?? [],
    paths,
  };

  for (const route of routes) {
    const { docs, path, method, schema, returning } = route;

    const desc: OpenAPI.OperationObject = docs
      ? { ...docs }
      : { responses: { default: { description: 'No description found' } } };

    if (returning) {
      try {
        const responseSchema = extractJsonSchema(returning, false);

        desc.responses = merge(desc.responses, {
          default: {
            schema: responseSchema,
          },
        });
      } catch {
        /* allow error when extractJsonSchema */
      }
    }

    if (schema instanceof JSONSchema) {
      desc.requestBody = {
        content: {
          'application/json': {
            schema: schema.raw,
          },
        },
      };
    }

    for (const p of Array.isArray(path) ? path : [path]) {
      const parsed = parsePathString(p);
      const paramsPath = parsed
        .map(section => {
          if (typeof section === 'string') return section;
          return `${section.prefix}{${section.name}}${section.suffix}`;
        })
        .join('');

      desc.parameters = parsed
        .filter(s => typeof s !== 'string')
        .map(param => {
          if (typeof param === 'string') throw 'impossible';

          let schema;

          if (param.pattern === '\\d+') {
            schema = { type: 'integer' } as const;
          }

          return {
            in: 'path',
            name: `${param.name}`,
            required: !param.modifier.includes('?'),
            schema,
          };
        });

      paths[paramsPath] = paths[paramsPath] || {};

      for (const m of Array.isArray(method) ? method : [method]) {
        paths[paramsPath][m] = desc;
      }
    }
  }

  return openAPI;
};

/**
 * Wraps all failures that are thrown exceptions in a known JSON format
 *
 * Looks like: { success: false, code: number, message: string, data: any | null }
 */
export const propagateErrors = (
  includeInternalErrors: boolean,
  transform?: (
    err: any,
    body: {
      success: false;
      code: number;
      message: string;
      data: any | null;
    },
    ctx: Context,
  ) => Promise<any> | any,
): Middleware => async (ctx, next) => {
  if (ctx.state.hasPropagateErrorWrapping) {
    return next();
  }

  ctx.state.hasPropagateErrorWrapping = true;

  try {
    await next();
  } catch (error) {
    ctx.status = error.status || error.statusCode || 500;

    const body = {
      success: false as const,
      code: error.code || ctx.status,
      message: filterInternalMessages(ctx.status, error.message, includeInternalErrors),
      data: error.data || null,
    };

    const response = transform ? await transform(error, body, ctx) : body;

    ctx.body = response;

    // app can listen for this event for global error handling
    ctx.app.emit('servall-err', { error, response }, ctx);
  }
};

/**
 * Wraps all JSON responses in consistent structure, which maps with propagateErrors well
 *
 * Looks like: { success: true, data: any, meta: any }
 *
 * See addMeta for specifying meta info - or do so yourself in ctx.state.meta
 */
export const propagateValues = (): Middleware => async (ctx, next) => {
  await next();

  const { body } = ctx;

  if (body && typeof body === 'object') {
    // checks for Buffers and roughly, streams. not exactly comprehensive but nothing really can be.
    if (Buffer.isBuffer(body)) return;
    if (typeof body.read === 'function') return;
    if ('success' in body) return;

    // set properties in meta to be carried into the body
    const { meta } = ctx.state;

    ctx.body = {
      success: true,
      data: body,
      meta,
    };
  }
};

/**
 * Adds meta info when using propagateValues middleware
 */
export const addMeta = (ctx: Context, properties: { [key: string]: any }) => {
  if (!ctx.state.meta) ctx.state.meta = {};
  Object.assign(ctx.state.meta, properties);
};

/**
 * Binds a route definition to a koa router. Can be used with a route directly,
 * or (more usefully) can be used with a MadeRoute from {@link createRoutes} / {@link createAllRoutes}.
 *
 * This function can be useful for incremental adoption, enabling you to
 * do something like this:
 *
 * ```
 * import * as Koa from 'koa';
 * import * as Router from 'koa-router';
 *
 * const app = new Koa();
 * const router = new Router();
 *
 * addRouteToRouter(
 *   route({
 *     path: '/my-route',
 *     method: HttpMethod.GET,
 *     returning: {
 *       foo: true,
 *     },
 *     async action() {
 *       return {
 *         foo: 'bar',
 *         bar: 'baz',
 *       };
 *     },
 *   }),
 *   router,
 * );
 * ```
 */
export const addRouteToRouter = (route: Route | MadeRoute, router: Router) => {
  const { path, action, method, schema, querySchema, returning } = route;

  // eslint-disable-next-line
  const middleware = route.middleware
    ? typeof route.middleware === 'function'
      ? route.middleware()
      : route.middleware
    : [];

  const routerMiddleware = 'routerMiddleware' in route ? route.routerMiddleware ?? [] : [];

  const methods = Array.isArray(method) ? method : [method];

  methods.forEach(method => {
    // access the router.get function dynamically from HttpMethod strings
    const bindFn = router[method].bind(router);

    // router-level middleware comes before schema, action-level middleware comes after
    bindFn(path, ...routerMiddleware);

    if (schema) {
      bindFn(path, async (ctx, next) => {
        const { body } = ctx.request;

        if (body === undefined) {
          throw new BaseError('a request body is required', 400);
        }

        const result = await schema.validate(body);

        if (result !== true) {
          throw result;
        }

        await next();
      });
    }

    if (querySchema) {
      bindFn(path, async (ctx, next) => {
        const { query } = ctx.request;

        const result = await querySchema.validate(query);

        if (result !== true) {
          throw result;
        }

        await next();
      });
    }

    bindFn(path, ...middleware);

    bindFn(path, async (ctx, next) => {
      try {
        const response = await action(ctx, next);

        if (response || ctx.status === 204) {
          if (ctx.body) {
            console.warn('overwriting ctx.body, which was set in a route handler');
          }

          if (returning) {
            ctx.body = extract(response, returning);
          } else {
            ctx.body = response || '';
          }
        } else if (response === undefined && ctx.body === undefined) {
          throw {
            status: 500,
            message:
              `You did not return anything in the route '${path}'.` +
              "If this was on purpose, please return 'false'",
          };
        } else if (!ctx.body) {
          ctx.status = 204;
        }
      } catch (error) {
        if (typeof error === 'string') {
          error = new Error(error);
        }

        error.code = error.code || -1;
        error.status = error.status || error.statusCode || 500;
        error.internalMessage = error.message;
        error.stackTrace = error.stack && parseStackTrace(error.stack);

        // don't reveal internal message unless you've opted-in by extending BaseError
        if (!(error instanceof BaseError) && process.env.NODE_ENV === 'production') {
          error.message = 'Internal server error (see logs)';
        }

        throw error;
      }
    });
  });
};

function filterInternalMessages(
  status: number,
  errorMessage: string,
  includeInternalErrors: boolean,
) {
  if (status >= 500 && !includeInternalErrors) {
    return 'Internal server error (see logs)';
  }

  return errorMessage;
}
