import * as Koa from 'koa';
import * as Router from 'koa-router';
import * as fs from 'fs-extra';
import * as Ajv from 'ajv';
import { join } from 'path';

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

  constructor(message: string, code: number = 500, statusCode: number = code) {
    super(message);

    this.message = message;
    this.code = code;
    this.statusCode = statusCode;
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

export enum SchemaType {
  JSON,
}

export interface Schema {
  type: SchemaType;
  obj: object;
}

export class JSONSchema implements Schema {
  readonly type: SchemaType = SchemaType.JSON;
  readonly obj: object;

  constructor(schema: object) {
    this.obj = schema;
  }
}

export type RouteActionResponse = Promise<object | string | void>;
export type RouteAction = ReplaceReturnType<Middleware, RouteActionResponse>;
export type RouteActionWithContext<T> = AddContext<RouteAction, T>;

export interface RouteFactory<T> {
  readonly prefix?: string;
  getDependencies: () => Promise<T> | T;
  create: (dependencies: T) => Promise<Route[]> | Route[];
  middleware?: (dependencies: T) => Promise<Middleware[]> | Middleware[];
}

export interface RouteWithContext<Ctx> {
  path: string;
  method: HttpMethod;
  schema?: Schema;
  action: RouteActionWithContext<Ctx>;
  middleware?: Middleware[];
}

export type Route = RouteWithContext<void>;

export const bindRouteActions = <Ctx>(c: Ctx, routes: RouteWithContext<Ctx>[]) => {
  return routes.map(route => ({
    ...route,
    action: route.action.bind(c),
  }));
};

const getRouteModules = (dir: string): RouteFactory<any>[] => fs.readdirSync(dir)
  .filter(n => n.match(/\.(j|t)s$/))
  .filter(n => !n.match(/\.d\.ts$/))
  .filter(n => !n.match(/^index\./))
  .map((filename) => {
    const { default: factory }: {
      default: RouteFactory<any>,
    } = require(join(dir, filename));

    if (!factory) throw new Error(`missing default export: ${join(dir, filename)}`);

    // we account for 'export default class implements RouteFactory' here by just doing `new` for it
    if (!factory.create) {
      const FactoryClass = factory as any as (new () => RouteFactory<any>);
      return new FactoryClass();
    }

    return factory;
  });

const createRoutes = async (modules: RouteFactory<any>[]) => {
  const routerRoutes: Route[][] = await Promise.all(modules.map(async (factory) => {
    // inject dependencies
    const dependencies = await factory.getDependencies();
    const routes: Route[] = await factory.create(dependencies);

    let routerMiddleware: Middleware[] | undefined;

    if (factory.middleware) {
      routerMiddleware = await factory.middleware(dependencies);
    }

    return routes.map(route => ({
      ...route,
      // add the prefix of the router to each Route
      path: join(factory.prefix || '', route.path),
      // inject top level middleware ahead of the specific route's middleware
      middleware: [
        ...(routerMiddleware || []),
        ...(route.middleware || []),
      ],
    }));
  }));

  // flatten all routes
  return routerRoutes.reduce<Route[]>((acc, routes) => acc.concat(routes), []);
};

export const createRouter = async (dir: string) => {
  const router = new Router();
  const ajv = new Ajv();

  console.log('Mounting routes...');

  // Call router.get(), router.post(), router.put(), etc, to set up routes
  (await createRoutes(getRouteModules(dir))).forEach((route) => {
    const {
      path,
      action,
      method,
      schema,
      middleware = [],
    } = route;

    let validate: (body: any) => void;

    if (schema) {
      if (schema.type !== SchemaType.JSON) {
        throw new Error('non json schema not supported');
      }

      const validateSchema = ajv.compile({
        // default to draft 7, but of course the schema can just overwrite this
        $schema: 'http://json-schema.org/draft-07/schema#',
        ...schema.obj,
      });

      validate = (body) => {
        const valid = validateSchema(body);

        if (!valid) {
          const err = validateSchema.errors &&
            validateSchema.errors
            .map(({ dataPath, message }) => `${dataPath}: ${message}`)
            .join(', ');

          throw new BaseError(`validation error: [${err}]`, 400);
        }
      };
    }

    // access the router.get function dynamically from HttpMethod strings
    const bindFn = router[method].bind(router);

    console.log(`\t${path}`);
    bindFn(path, ...middleware, async (ctx, next) => {
      try {
        // validation only works if bodyparser is present
        const request = (ctx.request as any);

        if (validate && request.body) {
          validate(request.body);
        }

        const response = await action(ctx, next);

        if (response) {
          if (ctx.body) {
            console.warn('overwriting ctx.body, which was set in a route handler');
          }

          ctx.body = response;
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
          error.message = 'Something went wrong';
        }

        throw error;
      }
    });
  });

  return router;
};
