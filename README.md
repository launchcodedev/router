# Use Me!
```typescript
import * as path from 'path';
import { createRouter } from '@servall/router';

const api = await createRouter(path.join(__dirname, 'routes'));

api.prefix('/api');

app
  .use(api.routes())
  .use(api.allowedMethods())
```

Your routers go in a flat directory (in the above, the `routes` folder).

They look like:

```typescript
import {
  RouteFactory,
  RouteActionWithContext,
  HttpMethod,
  bindRouteActions,
} from '@servall/router';

type DbConnection = {
  isConnected: boolean;
};

interface Dependencies {
  db: DbConnection;
};

const dbStatus: RouteActionWithContext<Dependencies> = async function(ctx, next) {
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
          // you can always declare actions inline, which makes types easier
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
```

You can also opt to use the "class style":

```typescript
import {
  RouteFactory,
  RouteActionWithContext,
  HttpMethod,
  Context,
  Next,
  bindRouteActions,
} from '@servall/router';

type DbConnection = {
  isConnected: boolean;
};

interface Dependencies {
  db: DbConnection;
};

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
```

Note that the class based approach has it's actions as static. If they were not,
`create` could not be called twice because it would destroy `this`.
