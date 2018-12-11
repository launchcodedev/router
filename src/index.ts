import * as Koa from 'koa';
import * as Router from 'koa-router';
import * as fs from 'fs-extra';
import * as Ajv from 'ajv';
import { basename, join } from 'path';

export type Middleware = Router.IMiddleware;

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
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
  HEAD = 'HEAD',
  OPTIONS = 'OPTIONS',

  /// special value that binds to all http methods
  all = 'all',
}

export enum SchemaType {
  JSON,
}

type Context = Koa.Context & {
  request: {
    body?: {
      [key: string]: any;
    },
  },
};

export type RouteActionResponse = Promise<object | string | void>;
export type RouteAction = (ctx: Context, next: Function) => RouteActionResponse;

export interface RouteFactory<T> {
  prefix?: string;
  getDependencies: () => Promise<T> | T;
  create: (dependencies: T) => Promise<Route[]> | Route[];
  middleware?: (dependencies: T) => Promise<Middleware[]> | Middleware[];
}

export interface Route {
  path: string;
  method: HttpMethod;
  schema?: { type: SchemaType, obj: object };
  action: RouteAction;
  middleware?: Middleware[];
}

// same as a Route, but with a Ctx object as 'this' in the action
export interface RouteWithContext<Ctx> {
  path: string;
  method: HttpMethod;
  schema?: { type: SchemaType, obj: object };
  action: (this: Ctx, ctx: Context, next: Function) => RouteActionResponse;
  middleware?: Middleware[];
}

export const createRoutesWithCtx = <Ctx>(c: Ctx, routes: RouteWithContext<Ctx>[]) => {
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
    const dynRouter = (router as any as { [key: string]: Function });
    const bindFn: Function = dynRouter[method.toLowerCase()].bind(dynRouter);

    console.log(`\t${path}`);
    bindFn(path, ...middleware, async (ctx: Context, next: Function) => {
      try {
        if (validate) {
          validate(ctx.request.body);
        }

        const response = await action(ctx, next);

        if (response) {
          if (ctx.body) {
            console.warn('overwriting ctx.body, which was set in a route handler');
          }

          ctx.body = response;
        }
      } catch (error) {
        console.error(error);

        const payload = {
          success: false,
          code: error.code,
          message: 'Something went wrong',
        };

        // don't reveal internal details unless you've opted-in by extending BaseError
        if (error instanceof BaseError || process.env.NODE_ENV === 'development') {
          payload.message = error.message;
        }

        ctx.status = error.statusCode || 500;
        ctx.body = payload;
      }
    });
  });

  return router;
};
