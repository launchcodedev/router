import {
  RouteFactory,
  RouteActionWithContext,
  HttpMethod,
  Context,
  Next,
  bindRouteActions,
} from './index';

test('bindRouteActions', () => {
  expect.assertions(1);
  const routes = bindRouteActions({ foo: true }, [
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
