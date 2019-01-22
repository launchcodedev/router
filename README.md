# Servall Router
This is our main `@servall/router` node package, for centralizing the logic that
all of our backend applications share. It's designed for usage in koa servers.

It's built fairly simply, with a couple core ideas:

- Routes are contained within one folder, which is (mostly) a flat structure
- Routes are hierarchical, but usually one level deep
- Routes typically consist of one "action", prefixed by the middleware necessary

To help development remain consistent, we've made a package for encapsulating that logic.
This is not a web server, it's not a resource manager, it's not an API structure; just a tool.

So how do you use it?

```typescript
import { join } from 'path';
import { createRouter } from '@servall/router';

// here, we have a folder (./routes) that contains many Routers
// `api` here conglomerates all of them into one single koa-router
const api = await createRouter(join(__dirname, 'routes'));

// you can use the router just like koa-router
const myServer = new Koa();
myServer.use(api.routes());
myServer.use(api.allowedMethods());
```

Cool! But what about those files in `./routes`? Let's look at their expected structure.

```typescript
import {
  RouteFactory,
  RouteActionWithContext,
  HttpMethod,
  bindRouteActions,
} from '@servall/router';

// we'll leave this blank for now
interface Dependencies {}

const factory: RouteFactory<Dependencies> = {
  getDependencies() {
    return {};
  },

  create(dependencies: Dependencies) {
    return bindRouteActions(dependencies, [
      {
        path: '/hello-world',
        method: HttpMethod.GET,
        async action(ctx, next) {
          return { hello: 'world!' };
        },
      },
    ]);
  },
};

// important - default export needs to be a RouteFactory or a class implementing it
export default factory;
```

Alright, so we now have a 'RouteFactory', whatever that is. If this file was in `./routes`,
you'd now have a successful `/hello-world` GET route.

A few explanations:

1. We export a RouteFactory to make testing and dependency injection easier
1. We use `bindRouteActions` for type safety and contextual functions (dependencies are available on `this`)
1. We define `Dependencies` so that you can be explicit about what other modules are used

So on to dependencies. We'll leave the imports and export out for brevity.

```typescript
interface Dependencies {
  databaseConnection: Postgres;
}

const factory: RouteFactory<Dependencies> = {
  getDependencies() {
    return {
      databaseConnection: getTheDefaultDatabaseConnection(),
    };
  },

  create(dependencies: Dependencies) {
    return bindRouteActions(dependencies, [
      {
        path: '/some-entity',
        method: HttpMethod.GET,
        async action(ctx, next) {
          // we now have access to `databaseConnection` through `this`!

          // and we can return whatever we want, which will end up as a json response!
          return this.databaseConnection.query('select * from some_entity');
        },
      },
    ]);
  },
};
```

The key here is, that `getDependencies` is solely a helper. For testing, you might forgo it entirely,
and `create` the router yourself with a mocked up database.

You're not limited to a raw object. You can define your own class like so:

```typescript
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
    return bindRouteActions(dependencies, [
      {
        path: '/status',
        method: HttpMethod.GET,
        action: DbRouter.dbStatus,
      },
    ]);
  }

  static async dbStatus(this: Dependencies, ctx: Context, next: Next) {
    return {
      connected: this.db.isConnected,
    };
  }
}
```

You can always declare route actions outside of the create function, of course.

```typescript
const dbStatus: RouteActionWithContext<Dependencies> = async function(ctx, next) {
  return {
    connected: this.db.isConnected,
  };
};
```

You might opt to make a type alias in your routers for `RouteActionWithContext<Dependencies>` as `Action`.

### Prefix
Prefixes get applied to all actions in a router. That means `prefix: '/auth'` puts all your actions after
that path prefix. You can forgo this an specify absolute paths if your actions if you want.

### Middleware
You can declare middleware for a router, and/or per route. This allows flexibility and coverage.

```typescript
const factory: RouteFactory<Dependencies> = {
  getDependencies() { ... },
  create(dependencies: Dependencies) { ... },

  async middleware(dependencies: Dependencies) {
    return [
      // middleware here gets applied to all actions
      // you might put authentication middleware here, for example
    ];
  },
};
```

The same interface is available per-action. Just specify `middleware: []` beside `path` and friends.

### Schemas
We support JSON Schema natively to validate incoming request bodies. Simply put a `schema` property next
to you `action`.

```typescript
{
  path: '/resource/:id',
  method: HttpMethod.POST,
  schema: new JSONSchema({
    properties: {
      x: {
        type: 'number',
      },
      y: {
        type: 'number',
      },
    },
  }),
  async action(ctx) {
    // ctx.request.body is valid at this point
  },
}
```

This does depend on having `koa-bodyparser` in your app.

### Nesting
The Servall router is usually used in mostly flat contexts, but you can easily nest your routers.

```typescript
import {
  RouteFactory,
  findRoutes,
} from '@servall/router';

const factory: RouteFactory<Dependencies> = {
  prefix: '/support',
  nested: () => findRoutes(join(__dirname, 'support')),

  getDependencies() { ... },
  create(dependencies: Dependencies) { ... },
};
```

The example above nests routes found in the `./support` folder.

### Errors
The Servall router normalizes errors that come from your actions. This pairs nicely with `@servall/logger`.

What you need to know:

- `@servall/router` exports `BaseError`, which is "a user visible error"
- In development, you'll always see your error messages
- In production, only errors the are BaseErrors propagate up (see `internalMessage` for full details)

You'll likely want to use `propagateErrors`, though it is strictly optional.

```typescript
import { propagateErrors } from '@servall/router';

// try to keep this as high as you can in your middleware stack
myServer.use(propagateErrors());

myServer.use(api.routes());
myServer.use(api.allowedMethods());
```

This will catch normalized errors, and return them in our standard json body format (and set the HTTP code).

```json
{
  "success": false,
  "code": "ERRCODE|num",
  "message": "User visible message"
}
```

### API Fields
Often times, we have entities from our ORM that contain lots of properties that we don't want exposed.
But it can be really taxing to do the destructuring boilerplate:

```typescript
async action(ctx) {
  const user = await this.db.findUser({ id: ctx.state.user.id });

  const {
    id,
    username,
    firstName,
    secondName,
    thirdName,
    forthName,
  } = user;

  return {
    id,
    username,
    firstName,
    secondName,
    thirdName,
    forthName,
  };
}
```

This can be alleviated using our API Field decorators and middleware.

In your `User` entity:

```typescript
import { ApiField } from '@servall/router';

class User extends BaseEntity {
  @ApiField()
  id: number;

  privateField: number;

  @ApiField()
  firstName: string;

  ...
}
```

Or alternatively, a blacklist instead of whitelist.

```typescript
import { ApiFields } from '@servall/router';

@ApiFields({
  exclude: ['privateField'],
})
class User extends BaseEntity {
  ...
}
```

Api fields are transitive - that is, a child of User with it's own ApiField
rules abides by them when being extracted.

To make this filtering do what you want, ensure that the middleware is set up.

```typescript
import { extractApiFieldsMiddleware } from '@servall/router';

app.use(extractApiFieldsMiddleware());
```

This is flexible on purpose, so that you only pay the price/complexity of
the filtering middleware where you need it. Obviously it's not a free operation,
but it should be very close performance wise to the manual version.
(not that this is very relevant)

This middleware guarantees that objects that didn't have ApiFields are not
affected at all.

You can call `extractApiFields` directly on objects as well.
