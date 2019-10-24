/* eslint-disable import/no-dynamic-require, global-require, no-throw-literal, no-ex-assign */
import * as Router from 'koa-router';
import * as fs from 'fs-extra';
import * as Ajv from 'ajv';
import * as yup from 'yup';
import * as YAML from 'js-yaml';
import { join } from 'path';
import * as stackTrace from 'stacktrace-parser';
import * as resolveFrom from 'resolve-from';
import * as bodyparser from 'koa-bodyparser';
import { SchemaBuilder, JsonSchemaType } from '@serafin/schema-builder';
import { Extraction, extract } from '@servall/mapper';
import { Json } from '@servall/ts';
// this module actually has no js, so eslint fails to resolve it
// eslint-disable-next-line import/no-unresolved
import * as OpenAPI from '@serafin/open-api';

export * from './decorators';

export { bodyparser };
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
        .map(({ keyword, dataPath, message, params }) => {
          if (keyword === 'additionalProperties') {
            return `${message}: ${(params as any).additionalProperty}`;
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
  middleware?: Middleware[];
}

export type Route = RouteWithContext<any>;

type MadeRoute = Route & {
  routerMiddleware: Middleware[];
};

export const routeWithBody = route;

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

export const bindRouteActions = <Ctx>(c: Ctx, routes: RouteWithContext<Ctx>[]): Route[] => {
  return routes.map(route => ({
    ...route,
    action: route.action.bind(c as any),
  }));
};

export const createRoutes = async <D>(factory: RouteFactory<D>, deps: D) => {
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

  const flatRoutes = routes.reduce(
    (routes, route) => {
      if (Array.isArray(route.path)) {
        return routes.concat(
          route.path.map(path => ({
            ...route,
            path,
          })),
        );
      }

      return routes.concat(route as FlatRoute);
    },
    [] as FlatRoute[],
  );

  return flatRoutes.map(route => ({
    ...route,
    // add the prefix of the router to each Route
    path: join(factory.prefix || '', route.path),
    middleware: route.middleware || [],
    routerMiddleware: [
      ...(routerMiddleware || []),
      ...((route as MadeRoute).routerMiddleware || []),
    ],
  }));
};

export const createAllRoutes = async (factories: RouteFactory<any>[]) => {
  // inject dependencies
  const routerRoutes = await Promise.all(
    factories.map(async factory => {
      return createRoutes(factory, await factory.getDependencies());
    }),
  );

  // flatten all routes
  return routerRoutes.reduce<MadeRoute[]>((acc, routes) => acc.concat(routes), []);
};

export const findRouters = async (dir: string): Promise<RouteFactory<any>[]> =>
  (await fs.readdir(dir))
    .filter(n => n.match(/\.(j|t)sx?$/))
    .filter(n => !n.match(/\.d\.ts$/))
    .filter(n => !n.match(/\.test\..*$/))
    .filter(n => !n.match(/^index\./))
    .map(filename => {
      const {
        default: factory,
      }: {
        default: RouteFactory<any>;
      } = require(join(dir, filename));

      if (!factory) throw new Error(`missing default export: ${join(dir, filename)}`);

      // we account for 'export default class implements RouteFactory' here by calling `new`
      if (!factory.create) {
        const FactoryClass = (factory as any) as (new () => RouteFactory<any>);
        return new FactoryClass();
      }

      return factory;
    });

export const createRouterRaw = async (routes: MadeRoute[], debug = false) => {
  const router = new Router();

  if (debug) {
    console.log('Mounting routes...');
  }

  // Call router.get(), router.post(), router.put(), etc, to set up routes
  routes.forEach(route => {
    const {
      path,
      action,
      method,
      schema,
      querySchema,
      returning,
      middleware = [],
      routerMiddleware = [],
    } = route;

    const methods = Array.isArray(method) ? method : [method];

    if (debug) {
      console.log(`\t[${methods.map(m => m.toUpperCase()).join(', ')}] ${path}`);
    }

    methods.forEach(method => {
      // access the router.get function dynamically from HttpMethod strings
      const bindFn = router[method].bind(router);

      // router-level middleware comes before schema, action-level middleware comes after
      bindFn(path, ...routerMiddleware);

      if (schema) {
        bindFn(path, async (ctx, next) => {
          const { body } = ctx.request as any;

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
          error.stackTrace = error.stack && stackTrace.parse(error.stack);

          // don't reveal internal message unless you've opted-in by extending BaseError
          if (!(error instanceof BaseError) && process.env.NODE_ENV === 'production') {
            error.message = 'Internal server error (see logs)';
          }

          throw error;
        }
      });
    });
  });

  return router;
};

export const createRouterFactories = async (factories: RouteFactory<any>[], debug = false) => {
  const routes = await createAllRoutes(factories);
  return createRouterRaw(routes, debug);
};

export const createRouter = async (dir: string, debug = false) => {
  const routes = await createAllRoutes(await findRouters(dir));
  return createRouterRaw(routes, debug);
};

export const createOpenAPI = (
  routes: MadeRoute[],
  meta: { info: OpenAPI.InfoObject; servers?: OpenAPI.ServerObject[] },
) => {
  const paths: OpenAPI.PathObject = {};

  const openAPI: OpenAPI.OpenAPIObject = {
    paths,
    openapi: '3.0.0',
    info: meta.info,
    servers: meta.servers || [],
  };

  for (const route of routes) {
    // TODO: extract parameters from paths
    const { docs, path, method, schema } = route;

    const desc: OpenAPI.OperationObject = docs
      ? { ...docs }
      : { responses: { default: { description: 'Responses are unknown' } } };

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
      paths[p] = paths[p] || {};

      for (const m of Array.isArray(method) ? method : [method]) {
        paths[p][m] = desc;
      }
    }
  }

  return openAPI;
};

const filterInternalMessages = (
  status: number,
  errorMessage: string,
  includeInternalErrors: boolean,
) => {
  if (status >= 500 && !includeInternalErrors) {
    return 'Internal server error (see logs)';
  }

  return errorMessage;
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
