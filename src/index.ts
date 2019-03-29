import * as Koa from 'koa';
import * as Router from 'koa-router';
import * as fs from 'fs-extra';
import * as Ajv from 'ajv';
import * as yup from 'yup';
import * as YAML from 'js-yaml';
import { join } from 'path';
import * as resolveFrom from 'resolve-from';
import { Extraction, extract } from '@servall/mapper';
export * from './decorators';

type ArgumentTypes<T> = T extends (...args: infer U) => unknown ? U : never;
type ReturnType<T> = T extends (...args: any) => infer R ? R : never;
type ReplaceReturnType<T, R extends ReturnType<T>> = (...a: ArgumentTypes<T>) => R;
type AddContext<T, TContext> = (this: TContext, ...a: ArgumentTypes<T>) => ReturnType<T>;

const environmentProtectedLogs: (string | undefined)[] = ['staging', 'production'];

export type Middleware = Router.IMiddleware;
export type Context = Router.IRouterContext;
export type Next = ArgumentTypes<Middleware>[1];

export class BaseError extends Error {
  code: number = 0;
  message: string = 'Something went wrong';
  statusCode: number = 500;

  constructor(message: string, code: number = 500, statusCode: number = code) {
    super(message);

    this.message = message;
    this.code = code;
    this.statusCode = statusCode;
  }

  static from(err: Error, code?: number, statusCode?: number) {
    return new BaseError(err.message || err.toString(), code, statusCode);
  }
}

export enum HttpMethod {
  GET = 'get',
  POST = 'post',
  PUT = 'put',
  PATCH = 'patch',
  DELETE = 'delete',
  HEAD = 'head',
  OPTIONS = 'options',

  /// special value that binds to all http methods
  all = 'all',
}

export interface Schema {
  validate: (body: any) => Promise<true | Error>;
}

export class JSONSchema implements Schema {
  readonly ajvValidate: Ajv.ValidateFunction;

  constructor(readonly raw: object) {
    this.ajvValidate = new Ajv().compile({
      // default to draft 7, but of course the schema can just overwrite this
      $schema: 'http://json-schema.org/draft-07/schema#',
      ...raw,
    });
  }

  static load(schemaName: string, schemaDir: string) {
    const path = resolveFrom(schemaDir, `./${schemaName}.json`);

    return new JSONSchema(require(path));
  }

  static loadYaml(schemaName: string, schemaDir: string, ext = 'yml') {
    const path = resolveFrom(schemaDir, `./${schemaName}.${ext}`);
    const contents = fs.readFileSync(path);
    return new JSONSchema(YAML.safeLoad(contents.toString('utf8')));
  }

  validate = async (body: any) => {
    const valid = this.ajvValidate(body);

    if (valid) {
      return true;
    }

    const err = this.ajvValidate.errors &&
      this.ajvValidate.errors
      .map(({ dataPath, message }) => `${dataPath}: ${message}`)
      .join(', ');

    return new BaseError(`validation error: [${err}]`, 400);
  }
}

export class YupSchema<T> implements Schema {
  constructor(readonly raw: yup.Schema<T>) {}

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
  }
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

export const bindRouteActions = <Ctx>(c: Ctx, routes: RouteWithContext<Ctx>[]) => {
  return routes.map(route => ({
    ...route,
    action: route.action.bind(c),
  }));
};

export const createRoutes = async <D>(factory: RouteFactory<D>, deps: D) => {
  const routes: Route[] = await factory.create(deps);

  let routerMiddleware: Middleware[] | undefined;

  if (factory.middleware) {
    routerMiddleware = await factory.middleware(deps);
  }

  if (factory.nested) {
    const nested = await factory.nested(deps);

    // NOTE: dependencies cannot be injected here, which may be difficult for testing
    routes.push(...await createAllRoutes(nested));
  }

  type FlatRoute = Route & { path: string };

  const flatRoutes = routes.reduce((routes, route) => {
    if (Array.isArray(route.path)) {
      return routes.concat(route.path.map(path => ({
        ...route,
        path,
      })));
    }

    return routes.concat(route as FlatRoute);
  }, [] as FlatRoute[]);

  return flatRoutes.map(route => ({
    ...route,
    // add the prefix of the router to each Route
    path: join(factory.prefix || '', route.path),
    middleware: route.middleware || [],
    routerMiddleware: routerMiddleware || [],
  }));
};

export const createAllRoutes = async (factories: RouteFactory<any>[]) => {
  // inject dependencies
  const routerRoutes = await Promise.all(factories.map(async (factory) => {
    return createRoutes(factory, await factory.getDependencies());
  }));

  // flatten all routes
  return routerRoutes.reduce<MadeRoute[]>((acc, routes) => acc.concat(routes), []);
};

export const findRouters = async (dir: string): Promise<RouteFactory<any>[]> =>
  (await fs.readdir(dir))
    .filter(n => n.match(/\.(j|t)sx?$/))
    .filter(n => !n.match(/\.d\.ts$/))
    .filter(n => !n.match(/^index\./))
    .map((filename) => {
      const { default: factory }: {
        default: RouteFactory<any>,
      } = require(join(dir, filename));

      if (!factory) throw new Error(`missing default export: ${join(dir, filename)}`);

      // we account for 'export default class implements RouteFactory' here by calling `new`
      if (!factory.create) {
        const FactoryClass = factory as any as (new () => RouteFactory<any>);
        return new FactoryClass();
      }

      return factory;
    });

export const createRouterRaw = async (routes: MadeRoute[], debug = false) => {
  const router = new Router();
  const ajv = new Ajv();

  if (debug) {
    console.log('Mounting routes...');
  }

  // Call router.get(), router.post(), router.put(), etc, to set up routes
  routes.forEach((route) => {
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

    methods.forEach((method) => {
      // access the router.get function dynamically from HttpMethod strings
      const bindFn = router[method].bind(router);

      // router-level middleware comes before schema, action-level middleware comes after
      bindFn(path, ...routerMiddleware);

      if (schema) {
        bindFn(path, async (ctx, next) => {
          const { body } = (ctx.request as any);

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
              message: `You did not return anything in the route '${path}'.`
                     + "If this was on purpose, please return 'false'",
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

export const propagateErrors = (): Middleware => async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.status = err.status || err.statusCode || 500;

    ctx.body = {
      success: false,
      code: err.code || ctx.status,
      message: filterMessage(ctx.status, err.message),
    };
  }
};

const filterMessage = (status: number, errorMessage: string) => {
  if (status >= 500 && environmentProtectedLogs.includes(process.env.NODE_ENV)) {
    return 'Internal server error (see logs)';
  }

  return errorMessage;
};
