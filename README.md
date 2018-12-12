# Use Me!
```typescript
import * as path from 'path';
import { createRouter } from './routes';

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
  createRoutesWithCtx,
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
    return createRoutesWithCtx(dependencies, [
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
  createRoutesWithCtx,
} from '@servall/router';

type DbConnection = {
  isConnected: boolean;
};

interface Dependencies {
  db: DbConnection;
};

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
    // NOTE that this is destructive / has side effects
    // you can't call create() twice on the same instance
    Object.assign(this, dependencies);

    return createRoutesWithCtx(this, [
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
```
