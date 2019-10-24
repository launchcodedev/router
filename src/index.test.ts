import { routerTest } from '@servall/router-testing';
import { SchemaBuilder } from '@serafin/schema-builder';
import { dir as tempDir } from 'tmp-promise';
import { writeJson, outputFile, remove } from 'fs-extra';
import { join } from 'path';
import {
  RouteFactory,
  RouteActionWithContext,
  HttpMethod,
  JSONSchema,
  YupSchema,
  err,
  routeWithBody,
  bindRouteActions,
  createAllRoutes,
  createOpenAPI,
  propagateErrors,
  propagateValues,
  addMeta,
  bodyparser,
} from './index';

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

  const test2: RouteActionWithContext<Dependencies> = async function() {
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
          async action() {
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

  await routerTest(factory, await factory.getDependencies(), async test => {
    await test.get('/prefixed/test1').expect({ foobar: 'baz' });

    await test.get('/prefixed/test2').expect({ foobar: 'baz' });
  });
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
          async action() {
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

    static async test2(this: Test & Dependencies) {
      return {
        foobar: this.foo,
      };
    }
  }

  await routerTest(new Test(), { foo: 'baz' }, async test => {
    await test.get('/prefixed/test1').expect({ foobar: 'baz' });

    await test.get('/prefixed/test2').expect({ foobar: 'baz' });
  });
});

test('readme factory example', async () => {
  type DbConnection = {
    isConnected: boolean;
  };

  interface Dependencies {
    db: DbConnection;
  }

  const dbStatus: RouteActionWithContext<Dependencies> = async function() {
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
          async action() {
            this.db.isConnected = false;

            return false;
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

  await routerTest(factory, await factory.getDependencies(), async test => {
    await test.get('/db/status').expect({ connected: true });

    await test.post('/db/disconnect').expect(204);

    await test.get('/db/status').expect({ connected: false });
  });
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
          async action() {
            this.db.isConnected = false;

            return false;
          },
        },
        {
          path: '/status',
          method: HttpMethod.GET,
          action: DbRouter.dbStatus,
        },
      ]);
    }

    static async dbStatus(this: DbRouter & Dependencies) {
      return {
        connected: this.db.isConnected,
      };
    }
  }

  await routerTest(new DbRouter(), await new DbRouter().getDependencies(), async test => {
    await test.get('/db/status').expect({ connected: true });

    await test.post('/db/disconnect').expect(204);

    await test.get('/db/status').expect({ connected: false });
  });
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
          async action() {
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
          async action() {
            return { name: 'top' };
          },
        },
      ]);
    },
  };

  await routerTest(factory, await factory.getDependencies(), async test => {
    await test.get('/all/top').expect({ name: 'top' });
    await test.get('/all/nested').expect({ name: 'nested' });
    await test.get('/all/invalid').expect(404);
    await test.get('/top').expect(404);
    await test.get('/nested').expect(404);
  });
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
          async action() {
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
          async action() {
            return { name: 'top' };
          },
        },
      ]);
    },
  };

  await routerTest(factory, await factory.getDependencies(), async test => {
    await test.get('/all/top').expect({ name: 'top' });
    await test.get('/all/b/nested').expect({ name: 'nested' });
    await test.get('/all/nested').expect(404);
  });
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
          async action() {
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
          async action() {
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
          async action() {
            return { name: 'top' };
          },
        },
      ]);
    },
  };

  await routerTest(factory, {}, async test => {
    await test.get('/all/top').expect({ name: 'top' });
    await test.get('/all/b/a/nested').expect({ name: 'nested-a' });
    await test.get('/all/b/nested').expect({ name: 'nested-b' });
    await test.get('/all/nested').expect(404);
  });
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
          async action() {
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
          async action() {
            return { name: 'top' };
          },
        },
      ]);
    },
  };

  await routerTest(factory, {}, async test => {
    await test.get('/top').expect({ name: 'top' });
    await test.get('/nested').expect({ name: 'nested' });
    await test.get('/invalid').expect(404);
  });
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
          async action() {
            return { name: 'test' };
          },
        },
      ]);
    },
  };

  await routerTest(factory, {}, async test => {
    await test.get('/test').expect({ name: 'test' });
    await test.post('/test').expect({ name: 'test' });
    await test.put('/test').expect(405);
  });
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
          async action() {
            return false;
          },
        },
      ]);
    },
  };

  await routerTest(factory, {}, async test => {
    await test.get('/test-1').expect(204);
  });
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
          async action(ctx) {
            ctx.body = { foo: 'bar' };
          },
        },
      ]);
    },
  };

  await routerTest(factory, {}, async test => {
    await test.get('/test-1').expect({ foo: 'bar' });
  });
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

  const { path: testDir } = await tempDir();
  await writeJson(join(testDir, 'test.json'), testData);

  const schema = JSONSchema.load('test', testDir);

  expect(schema).toBeDefined();
  expect(schema).toBeInstanceOf(JSONSchema);
  expect(schema.raw).toEqual(testData);

  await remove(testDir);
});

test('load yaml schema', async () => {
  const testData = {
    type: 'object',
    required: ['a', 'b'],
    properties: {
      a: { type: 'string' },
      b: { type: 'string' },
    },
  };

  const { path: testDir } = await tempDir();
  await outputFile(
    join(testDir, 'test.yml'),
    `
    type: object
    required: [a, b]
    properties:
      a:
        type: string
      b:
        type: string
  `,
  );

  const schema = JSONSchema.loadYaml('test', testDir);

  expect(schema).toBeDefined();
  expect(schema).toBeInstanceOf(JSONSchema);
  expect(schema.raw).toEqual(testData);

  await remove(testDir);
});

test('json schema validation', async () => {
  const factory: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    middleware() {
      return [bodyparser(), propagateErrors(true)];
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/test',
          method: HttpMethod.POST,
          schema: JSONSchema.raw({
            type: 'object',
            required: ['a', 'b'],
          }),
          async action() {
            return true;
          },
        },
        {
          path: '/additional',
          method: HttpMethod.POST,
          schema: JSONSchema.raw({
            type: 'object',
            required: ['a'],
            properties: {
              a: {
                type: 'boolean',
              },
            },
            additionalProperties: false,
          }),
          async action() {
            return true;
          },
        },
      ]);
    },
  };

  await routerTest(factory, {}, async test => {
    await test
      .post('/test')
      .send({ a: true, b: true })
      .expect('true');

    await test
      .post('/test')
      .send({})
      .expect(400);

    await test.post('/test').expect(400);

    await test
      .post('/additional')
      .send({ a: true, foo: 'bat' })
      .expect({
        success: false,
        code: 400,
        message: 'validation error: [should NOT have additional properties: foo]',
        data: null,
      });
  });
});

test('yup schema validation', async () => {
  const factory: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    middleware() {
      return [bodyparser(), propagateErrors(true)];
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/test',
          method: HttpMethod.POST,
          schema: YupSchema.create(yup =>
            yup.object().shape({
              foo: yup.string().required(),
              bar: yup.number(),
            }),
          ),
          async action() {
            return true;
          },
        },
      ]);
    },
  };

  await routerTest(factory, {}, async test => {
    await test
      .post('/test')
      .send({ foo: 'string', bar: 101 })
      .expect(200)
      .expect('true');

    await test
      .post('/test')
      .send({ foo: 'string' })
      .expect(200)
      .expect('true');

    await test
      .post('/test')
      .send({ foo: 101, bar: 'string' })
      .expect(400);

    await test
      .post('/test')
      .send({})
      .expect(400);

    await test.post('/test').expect(400);
  });
});

test('query schema validation', async () => {
  const factory: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    middleware() {
      return [bodyparser(), propagateErrors(true)];
    },

    create() {
      return [
        {
          path: '/test',
          method: HttpMethod.POST,
          querySchema: JSONSchema.raw({
            additionalProperties: false,
            required: ['x'],
            properties: {
              x: { type: 'string' },
            },
          }),
          async action() {
            return true;
          },
        },
      ];
    },
  };

  await routerTest(factory, {}, async test => {
    await test
      .post('/test?x=2jk')
      .expect(200)
      .expect('true');

    await test.post('/test?y=2jk').expect(400);

    await test.post('/test?x=111').expect(200);

    await test.post('/test').expect(400);
  });
});

test('extract response', async () => {
  const factory: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    middleware() {
      return [bodyparser(), propagateErrors(true)];
    },

    create() {
      return [
        {
          path: '/test',
          method: HttpMethod.GET,
          async action() {
            return {
              name: 'Albert',
              password: 'psswd',
              access: {
                permissions: ['admin'],
                viewable: {
                  resourceA: true,
                  timestamp: new Date(),
                },
              },
            };
          },
          returning: {
            name: true,
            access: {
              permissions: true,
              viewable: ['resourceA'],
            },
          },
        },
      ];
    },
  };

  await routerTest(factory, {}, async test => {
    await test.get('/test').expect({
      name: 'Albert',
      access: {
        permissions: ['admin'],
        viewable: {
          resourceA: true,
        },
      },
    });
  });
});

test('action path array', async () => {
  const factory: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: ['/test', '/test/1', '/1'],
          method: HttpMethod.GET,
          async action() {
            return { test: true };
          },
        },
      ]);
    },
  };

  await routerTest(factory, {}, async test => {
    await test
      .get('/test')
      .expect({ test: true })
      .expect(200);
    await test
      .get('/test/1')
      .expect({ test: true })
      .expect(200);
    await test
      .get('/1')
      .expect({ test: true })
      .expect(200);
    await test.get('/test/2').expect(404);
    await test.get('/2').expect(404);
  });
});

test('action path array with prefix', async () => {
  const factory: RouteFactory<{}> = {
    prefix: '/prefix',

    getDependencies() {
      return {};
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: ['/test', '/test/1', '/1'],
          method: [HttpMethod.GET, HttpMethod.POST],
          async action() {
            return { test: true };
          },
        },
      ]);
    },
  };

  await routerTest(factory, {}, async test => {
    await test
      .get('/prefix/test')
      .expect({ test: true })
      .expect(200);
    await test
      .get('/prefix/test/1')
      .expect({ test: true })
      .expect(200);
    await test
      .get('/prefix/1')
      .expect({ test: true })
      .expect(200);
    await test.get('/prefix/test/2').expect(404);
    await test.get('/prefix/2').expect(404);
    await test.get('/test').expect(404);
    await test.get('/test/1').expect(404);
  });
});

test('empty body', async () => {
  const factory: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    middleware() {
      return [propagateErrors(true)];
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/test',
          method: HttpMethod.POST,
          schema: { validate: async () => true },
          async action() {
            return {};
          },
        },
      ]);
    },
  };

  await routerTest(factory, await factory.getDependencies(), async test => {
    await test.post('/test').expect(400);
  });
});

test('error data', async () => {
  const factory: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    middleware() {
      return [propagateErrors(true)];
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/test',
          method: HttpMethod.POST,
          async action() {
            throw err(400, 'foo').withData({ bar: true });
          },
        },
      ]);
    },
  };

  await routerTest(factory, await factory.getDependencies(), async test => {
    await test
      .post('/test')
      .expect(400)
      .expect({ success: false, code: -1, message: 'foo', data: { bar: true } });
  });
});

test('typed route', async () => {
  type Dependencies = { foo: string };

  const factory: RouteFactory<Dependencies> = {
    getDependencies() {
      return {
        foo: 'bar',
      };
    },

    middleware() {
      return [bodyparser(), propagateErrors(true)];
    },

    create(dependencies) {
      return bindRouteActions(dependencies, [
        routeWithBody({
          path: '/test',
          method: HttpMethod.POST,
          schema: SchemaBuilder.emptySchema()
            .addInteger('input')
            .addInteger('input2'),
          async action(_, body) {
            return { ...body, ...this };
          },
        }),
        {
          path: 'test2',
          method: HttpMethod.GET,
          async action() {
            return {};
          },
        },
        routeWithBody({
          path: '/test3',
          method: HttpMethod.PUT,
          schema: JSONSchema.build(b => b.emptySchema().addInteger('input')),
          async action(_, body) {
            return {
              input: body.input,
            };
          },
        }),
        routeWithBody({
          path: '/test4',
          method: HttpMethod.PUT,
          schema: JSONSchema.raw({
            type: 'object',
            additionalProperties: false,
            required: ['input'],
            properties: {
              input: { type: 'string' },
            },
          } as const),
          async action(_, body) {
            return {
              input: body.input,
            };
          },
        }),
      ]);
    },
  };

  await routerTest(factory, await factory.getDependencies(), async test => {
    await test.post('/test').expect(400);

    await test
      .post('/test')
      .send({ input: 1, input2: '2' })
      .expect(400);

    await test
      .put('/test3')
      .send({})
      .expect(400);

    await test
      .put('/test3')
      .send({ input: 1 })
      .expect({ input: 1 });

    await test
      .put('/test4')
      .send({})
      .expect(400);

    await test
      .put('/test4')
      .send({ input: 1 })
      .expect(400);

    await test
      .put('/test4')
      .send({ input: 'in' })
      .expect({ input: 'in' });

    await test.get('/test2').expect({});

    await test
      .post('/test')
      .send({ input: 1, input2: 2 })
      .expect(200)
      .expect({ input: 1, input2: 2, foo: 'bar' });
  });
});

test('docs', async () => {
  type Dependencies = {};

  const factory: RouteFactory<Dependencies> = {
    getDependencies() {
      return {};
    },

    create(dependencies) {
      return bindRouteActions(dependencies, [
        routeWithBody({
          path: '/unnamed',
          method: HttpMethod.POST,
          schema: SchemaBuilder.emptySchema()
            .addInteger('input')
            .addInteger('input2'),
          returning: {
            foo: {
              bar: true,
            },
          },
          async action(_, body) {
            return { foo: { bar: body.input } };
          },
        }),
        {
          path: '/named',
          docs: {
            summary: 'Special',
            description: 'Does certain things',
            responses: {
              200: {
                description: 'Success',
              },
            },
          },
          method: HttpMethod.POST,
          schema: JSONSchema.raw({
            type: 'object',
            properties: {
              input2: { type: 'string' },
            },
          }),
          returning: {
            foo: [{ bar: true }],
          },
          async action() {
            return { foo: [{ bar: 22 }] };
          },
        },
      ]);
    },
  };

  const info = {
    title: 'test',
    version: '1.0.0',
  };

  const docs = createOpenAPI(await createAllRoutes([factory]), { info });

  expect(docs).toEqual({
    openapi: '3.0.0',
    info: {
      title: 'test',
      version: '1.0.0',
    },
    servers: [],
    paths: {
      '/unnamed': {
        post: {
          responses: {
            default: { description: 'Responses are unknown' },
          },
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    input: { type: 'integer' },
                    input2: { type: 'integer' },
                  },
                  required: ['input', 'input2'],
                },
              },
            },
          },
        },
      },
      '/named': {
        post: {
          summary: 'Special',
          description: 'Does certain things',
          responses: {
            200: { description: 'Success' },
          },
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    input2: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
});

test('double middleware', async () => {
  const factory: RouteFactory<{}> = {
    prefix: '/inner',

    getDependencies() {
      return {};
    },

    middleware() {
      return [
        async (ctx, next) => {
          ctx.state.foo.bat = 'foo';
          await next();
        },
      ];
    },

    create(dependencies: {}) {
      return bindRouteActions(dependencies, [
        {
          path: '/test',
          method: HttpMethod.GET,
          async action(ctx) {
            return ctx.state.foo;
          },
        },
      ]);
    },
  };

  const nester: RouteFactory<{}> = {
    prefix: '/nest',
    nested: () => [factory],

    getDependencies() {
      return {};
    },

    middleware() {
      return [
        async (ctx, next) => {
          ctx.state.foo = { bar: 'baz' };
          await next();
        },
      ];
    },

    create() {
      return [];
    },
  };

  await routerTest(nester, {}, async test => {
    await test.get('/nest/inner/test').expect({ bar: 'baz', bat: 'foo' });
  });
});

test('propagate values', async () => {
  const factory: RouteFactory<void> = {
    getDependencies() {},

    middleware() {
      return [propagateErrors(true), propagateValues()];
    },

    create() {
      return [
        {
          path: '/test-a',
          method: HttpMethod.GET,
          async action() {
            return {
              foo: 'bar',
            };
          },
        },
        {
          path: '/test-b',
          method: HttpMethod.GET,
          async action() {
            return 'raw string';
          },
        },
        {
          path: '/test-c',
          method: HttpMethod.GET,
          async action() {
            return Buffer.from('foobar');
          },
        },
        {
          path: '/test-d',
          method: HttpMethod.GET,
          async action() {
            throw err(419, 'my error').withData({ foobar: true });
          },
        },
        {
          path: '/test-e',
          method: HttpMethod.GET,
          async action(ctx) {
            addMeta(ctx, { page: 1, pages: 100 });

            return [{ bar: 'foo' }];
          },
        },
      ];
    },
  };

  await routerTest(factory, undefined, async test => {
    await test.get('/test-a').expect({
      success: true,
      data: {
        foo: 'bar',
      },
    });

    await test.get('/test-b').expect('raw string');
    await test.get('/test-c').expect(Buffer.from('foobar'));
    await test
      .get('/test-d')
      .expect(419)
      .expect({
        success: false,
        code: -1,
        message: 'my error',
        data: { foobar: true },
      });
    await test.get('/test-e').expect({
      success: true,
      data: [{ bar: 'foo' }],
      meta: {
        page: 1,
        pages: 100,
      },
    });
  });
});
