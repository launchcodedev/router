import {
  RouteFactory,
  RouteActionWithContext,
  HttpMethod,
  Context,
  Next,
  createRoutesWithCtx,
} from './index';

test('createRoutesWithCtx', () => {
  expect.assertions(1);
  const routes = createRoutesWithCtx({ foo: true }, [
    {
      path: '/',
      method: HttpMethod.GET,
      async action() {
        expect(true).toBe(true);
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
      return createRoutesWithCtx(dependencies, [
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

  class Test implements RouteFactory<Dependencies>, Dependencies {
    prefix = '/prefixed';

    foo!: string;

    getDependencies() {
      return {
        foo: 'baz',
      };
    }

    create(dependencies: Dependencies) {
      return createRoutesWithCtx(dependencies, [
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
          action: this.test2,
        },
      ]);
    }

    async test2(ctx: Context, next: Next) {
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
      return createRoutesWithCtx(dependencies, [
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

  class DbRouter implements RouteFactory<Dependencies>, Dependencies {
    prefix = '/db';

    // dependencies are on the DbRouter instance, must ! since they are injected in create()
    db!: DbConnection;

    getDependencies() {
      return {
        db: { isConnected: true },
      };
    }

    create(dependencies: Dependencies) {
      Object.assign(this, dependencies);

      return createRoutesWithCtx(this, [
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
          action: this.dbStatus,
        },
      ]);
    }

    async dbStatus(ctx: Context, next: Next) {
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
