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

You could alternatively use `JSONSchema.load('schemaName', 'directory')` to load a JSON file if it's large.

We also support `yup` validation. Simply use the `YupSchema` class.

```typescript
{
  path: '/resource/:id',
  method: HttpMethod.POST,
  schema: YupSchema.create(yup => yup.object().shape({
    foo: yup.string().required(),
    bar: yup.number(),
  })),
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

### Extracting Returns
Taking an example route action:
```typescript
{
  path: '/users',
  method: HttpMethod.GET,
  async action(ctx, next) {
    return myDatabase.select('* from user');
  },
},
```

You might prefer not to include the `password` field here (excuse the contrived example).

To do so, the manual approach is:

```typescript
const { values, to, return } = { ... };

return { values, to, return };
```

This is clearly not great. Lots of duplication and possibility for errors. It doesn't work
for nesting objects well, and with multiple branches in an action, requires duplication.

You might opt to use our `returning` field instead.

```typescript
{
  path: '/users',
  method: HttpMethod.GET,
  returning: {
    firstName: true,
    lastName: true,
    permissions: [{
      role: true,
      authority: ['access'],
    }],
  },
  async action(ctx, next) {
    return myDatabase.select('* from user');
  },
},
```

You can think of this as the inverse of `schema`. Some examples of this:

```
INPUT:
{
  firstName: 'Bob',
  lastName: 'Albert',
  password: 'secure!',
  permissions: [
    { role: 'admin', timestamp: new Date(), authority: { access: 33 } },
    { role: 'user', timestamp: new Date(), extra: false },
  ],
}

RETURNING:
{
  firstName: true,
  lastName: true,
  permissions: [{
    role: true,
    authority: ['access'],
  }],
}

RESULT:
{
  firstName: 'Bob',
  lastName: 'Albert',
  permissions: [
    { role: 'admin', authority: { access: 33 } },
    { role: 'user' },
  ],
}
```

Note a couple things:

- `['access']` means "pull these fields from the object" - it's the same as `{ access: true }`
- `[{ ... }]` means "map this array with this selector"
- `{ foo: true }` means "take only 'foo'"

Mismatching types, like an array selector when the return is an object, are ignored.

This is pulled directly from the `@servall/mapper` package, you can read more there.

### API Fields
You might want to reduce the duplication when extracting return values. Most of the time,
you want to return the same fields for the same entities, records, etc.

You can use our decorator for just that:

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

In your route action, simply:

```typescript
import { getApiFields } from '@servall/router';

{
  path: '/users/:id',
  method: HttpMethod.GET,
  returning: getApiFields(User),
  async action(ctx, next) {
    return myDatabase.select('from user where id = $0', id);
  },
},
```
