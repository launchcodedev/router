import { routerTest } from '@servall/router-testing';
import * as bodyparser from 'koa-bodyparser';
import * as Koa from 'koa';
import * as supertest from 'supertest';
import {
  RouteFactory,
  RouteActionWithContext,
  HttpMethod,
  Context,
  Next,
  ApiFields,
  JSONSchema,
  extractApiFieldsMiddleware,
  bindRouteActions,
  createRouterFactories,
  propagateErrors,
} from './index';
import { ensureDir, writeJson, remove } from 'fs-extra';
import { resolve } from 'path';

test('bindRouteActions', () => {
  expect.assertions(1);
  const routes = bindRouteActions({ foo: true }, [
    {
      path: '/',
      method: HttpMethod.GET,
      async action() {
        expect(this.foo).toBe(true);
      },
    },
  ]);

  routes[0].action(null as any, null as any);
});

test('router factory pattern', async () => {
  interface Dependencies {
    foo: string;
  }

  const test2: RouteActionWithContext<Dependencies> = async function (ctx, next) {
    return {
      foobar: this.foo,
    };
  };

  const factory: RouteFactory<Dependencies> = {
    prefix: '/prefixed',

    getDependencies() {
      return {
        foo: 'baz',
      };
    },

    create(dependencies: Dependencies) {
      return bindRouteActions(dependencies, [
        {
          path: '/test1',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return {
              foobar: this.foo,
            };
          },
        },
        {
          path: '/test2',
          method: HttpMethod.GET,
          action: test2,
        },
      ]);
    },
  };

  const routes = await factory.create(await factory.getDependencies());
  const res1 = await routes[0].action(null as any as Context, null as any as Next);
  const res2 = await routes[1].action(null as any as Context, null as any as Next);

  expect(res1).toEqual({ foobar: 'baz' });
  expect(res2).toEqual({ foobar: 'baz' });
});

test('router class pattern', async () => {
  interface Dependencies {
    foo: string;
  }

  class Test implements RouteFactory<Dependencies> {
    prefix = '/prefixed';

    getDependencies() {
      return {
        foo: 'baz',
      };
    }

    create(dependencies: Dependencies) {
      return bindRouteActions({ ...this, ...dependencies }, [
        {
          path: '/test1',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return {
              foobar: this.foo,
            };
          },
        },
        {
          path: '/test2',
          method: HttpMethod.GET,
          action: Test.test2,
        },
      ]);
    }

    static async test2(this: Test & Dependencies, ctx: Context, next: Next) {
      return {
        foobar: this.foo,
      };
    }
  }

  const factory = new Test();
  const routes = await factory.create(await factory.getDependencies());
  const res1 = await routes[0].action(null as any as Context, null as any as Next);
  const res2 = await routes[1].action(null as any as Context, null as any as Next);

  expect(res1).toEqual({ foobar: 'baz' });
  expect(res2).toEqual({ foobar: 'baz' });
});

test('readme factory example', async () => {
  type DbConnection = {
    isConnected: boolean;
  };

  interface Dependencies {
    db: DbConnection;
  }

  const dbStatus: RouteActionWithContext<Dependencies> = async function (ctx, next) {
    return {
      connected: this.db.isConnected,
    };
  };

  const factory: RouteFactory<Dependencies> = {
    prefix: '/db',

    getDependencies() {
      return {
        db: { isConnected: true },
      };
    },

    create(dependencies: Dependencies) {
      return bindRouteActions(dependencies, [
        {
          path: '/disconnect',
          method: HttpMethod.POST,
          async action(ctx, next) {
            this.db.isConnected = false;
          },
        },
        {
          path: '/status',
          method: HttpMethod.GET,
          action: dbStatus,
        },
      ]);
    },
  };

  const routes = await factory.create(await factory.getDependencies());

  const res1 = await routes[1].action(null as any as Context, null as any as Next);
  expect(res1).toEqual({ connected: true });

  // trigger disconnect
  await routes[0].action(null as any as Context, null as any as Next);

  const res2 = await routes[1].action(null as any as Context, null as any as Next);
  expect(res2).toEqual({ connected: false });
});

test('readme class example', async () => {
  type DbConnection = {
    isConnected: boolean;
  };

  interface Dependencies {
    db: DbConnection;
  }

  class DbRouter implements RouteFactory<Dependencies> {
    prefix = '/db';

    getDependencies() {
      return {
        db: { isConnected: true },
      };
    }

    create(dependencies: Dependencies) {
      return bindRouteActions({ ...this, ...dependencies }, [
        {
          path: '/disconnect',
          method: HttpMethod.POST,
          async action(ctx, next) {
            this.db.isConnected = false;
          },
        },
        {
          path: '/status',
          method: HttpMethod.GET,
          action: DbRouter.dbStatus,
        },
      ]);
    }

    static async dbStatus(this: DbRouter & Dependencies, ctx: Context, next: Next) {
      return {
        connected: this.db.isConnected,
      };
    }
  }

  const factory = new DbRouter();
  const routes = await factory.create(await factory.getDependencies());

  const res1 = await routes[1].action(null as any as Context, null as any as Next);
  expect(res1).toEqual({ connected: true });

  // trigger disconnect
  await routes[0].action(null as any as Context, null as any as Next);

  const res2 = await routes[1].action(null as any as Context, null as any as Next);
  expect(res2).toEqual({ connected: false });
});

test('nested routers', async () => {
  const nested: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/nested',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return { name: 'nested' };
          },
        },
      ]);
    },
  };

  const factory: RouteFactory<{}> = {
    prefix: '/all',
    nested: () => [nested],

    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/top',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return { name: 'top' };
          },
        },
      ]);
    },
  };

  const router = await createRouterFactories([factory]);

  const app = new Koa();
  app.use(router.routes());
  app.use(router.allowedMethods());
  const server = app.listen();
  const test = supertest.agent(server);
  await test.get('/all/top').expect({ name: 'top' });
  await test.get('/all/nested').expect({ name: 'nested' });
  await test.get('/all/invalid').expect(404);
  await test.get('/top').expect(404);
  await test.get('/nested').expect(404);

  await new Promise(resolve => server.close(resolve));
});

test('nested router with prefix', async () => {
  const nested: RouteFactory<{}> = {
    prefix: '/b',

    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/nested',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return { name: 'nested' };
          },
        },
      ]);
    },
  };

  const factory: RouteFactory<{}> = {
    prefix: '/all',
    nested: () => [nested],

    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/top',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return { name: 'top' };
          },
        },
      ]);
    },
  };

  const router = await createRouterFactories([factory]);
  const app = new Koa();
  app.use(router.routes());
  app.use(router.allowedMethods());
  const server = app.listen();
  const test = supertest.agent(server);

  await test.get('/all/top').expect({ name: 'top' });
  await test.get('/all/b/nested').expect({ name: 'nested' });
  await test.get('/all/nested').expect(404);

  await new Promise(resolve => server.close(resolve));
});

test('double nested router', async () => {
  const deep: RouteFactory<{}> = {
    prefix: '/a',

    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/nested',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return { name: 'nested-a' };
          },
        },
      ]);
    },
  };

  const nested: RouteFactory<{}> = {
    prefix: '/b',
    nested: () => [deep],

    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/nested',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return { name: 'nested-b' };
          },
        },
      ]);
    },
  };

  const factory: RouteFactory<{}> = {
    prefix: '/all',
    nested: () => [nested],

    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/top',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return { name: 'top' };
          },
        },
      ]);
    },
  };

  const router = await createRouterFactories([factory]);
  const app = new Koa();
  app.use(router.routes());
  app.use(router.allowedMethods());
  const server = app.listen();
  const test = supertest.agent(server);

  await test.get('/all/top').expect({ name: 'top' });
  await test.get('/all/b/a/nested').expect({ name: 'nested-a' });
  await test.get('/all/b/nested').expect({ name: 'nested-b' });
  await test.get('/all/nested').expect(404);

  await new Promise(resolve => server.close(resolve));
});

test('flat nested routers', async () => {
  const nested: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/nested',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return { name: 'nested' };
          },
        },
      ]);
    },
  };

  const factory: RouteFactory<{}> = {
    nested: () => [nested],

    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/top',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return { name: 'top' };
          },
        },
      ]);
    },
  };

  const router = await createRouterFactories([factory]);

  const app = new Koa();
  app.use(router.routes());
  app.use(router.allowedMethods());
  const server = app.listen();
  const test = supertest.agent(server);
  await test.get('/top').expect({ name: 'top' });
  await test.get('/nested').expect({ name: 'nested' });
  await test.get('/invalid').expect(404);

  await new Promise(resolve => server.close(resolve));
});

test('multiple methods', async () => {
  const factory: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/test',
          method: [HttpMethod.GET, HttpMethod.POST],
          async action(ctx, next) {
            return { name: 'test' };
          },
        },
      ]);
    },
  };

  const router = await createRouterFactories([factory]);

  const app = new Koa();
  app.use(router.routes());
  app.use(router.allowedMethods());
  const server = app.listen();
  const test = supertest.agent(server);

  await test.get('/test').expect({ name: 'test' });
  await test.post('/test').expect({ name: 'test' });
  await test.put('/test').expect(405);

  await new Promise(resolve => server.close(resolve));
});

test('api fields middleware', async () => {
  @ApiFields({ exclude: ['b'] })
  class MyEntity {
    a: string = 'prop-a';
    b: string = 'prop-b';
    c: string = 'prop-c';
  }

  const factory: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    middleware() {
      return [extractApiFieldsMiddleware()];
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/test-1',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return new MyEntity();
          },
        },
        {
          path: '/test-2',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return { rawResponse: true };
          },
        },
      ]);
    },
  };

  const router = await createRouterFactories([factory]);

  const app = new Koa();
  app.use(router.routes());
  app.use(router.allowedMethods());
  const server = app.listen();
  const test = supertest.agent(server);

  await test.get('/test-1').expect({ a: 'prop-a', c: 'prop-c' });
  await test.get('/test-2').expect({ rawResponse: true });

  await new Promise(resolve => server.close(resolve));
});

test('empty response', async () => {
  const factory: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/test-1',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return false;
          },
        },
      ]);
    },
  };

  const router = await createRouterFactories([factory]);

  const app = new Koa();
  app.use(router.routes());
  app.use(router.allowedMethods());
  const server = app.listen();
  const test = supertest.agent(server);

  await test.get('/test-1').expect(204);

  await new Promise(resolve => server.close(resolve));
});

test('setting body', async () => {
  const factory: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/test-1',
          method: HttpMethod.GET,
          async action(ctx, next) {
            ctx.body = { foo: 'bar' };
          },
        },
      ]);
    },
  };

  const router = await createRouterFactories([factory]);

  const app = new Koa();
  app.use(router.routes());
  app.use(router.allowedMethods());
  const server = app.listen();
  const test = supertest.agent(server);

  await test.get('/test-1').expect({ foo: 'bar' });

  await new Promise(resolve => server.close(resolve));
});

test('load schema', async () => {
  const testData = {
    type: 'object',
    required: ['a', 'b'],
    properties: {
      a: { type: 'string' },
      b: { type: 'string' },
    },
  };
  const testDir = resolve('./schemas');
  await ensureDir(testDir);
  await writeJson(`${testDir}/test.json`, testData);

  const schema = JSONSchema.load('test', 'schemas');

  expect(schema).toBeDefined();
  expect(schema).toBeInstanceOf(JSONSchema);
  expect(schema.raw).toEqual(testData);

  await remove(testDir);
});

test('schema validation', async () => {
  const factory: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    middleware() {
      return [
        bodyparser(),
        propagateErrors(),
      ];
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/test',
          method: HttpMethod.POST,
          schema: new JSONSchema({
            type: 'object',
            required: ['a', 'b'],
          }),
          async action(ctx, next) {
            return true;
          },
        },
      ]);
    },
  };

  await routerTest(factory, {}, async (test) => {
    await test.post('/test').send({ a: true, b: true })
      .expect('true');

    await test.post('/test')
      .expect(400);
  });
});
