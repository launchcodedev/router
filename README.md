# Launchcode Router
This is our main `@lcdev/router` node package, for centralizing the logic that
all of our backend applications share. It's designed for usage in koa servers.

It's built fairly simply, with a couple core ideas:

- Routes are contained within one folder, which is (mostly) a flat structure
- Routes are hierarchical, but usually one level deep
- Routes typically consist of one "action", prefixed by the middleware necessary

To help development remain consistent, we've made a package for encapsulating that logic.
This is not a web server, it's not a resource manager, it's not an API structure; just a tool.

### Quick Start
[![](https://shields.servallapps.com/npm/v/@lcdev/router.svg?registry_uri=https%3A%2F%2Fnpm.servalldatasystems.com)](https://npm.servalldatasystems.com/#/detail/@lcdev/router)

```bash
# replace VERSION below with the most recent major version above (eg. 0.5.1 -> 0.5, 1.2.3 -> 1)
yarn add @lcdev/router@VERSION
```

So how do you use it?

```typescript
import { join } from 'path';
import { createRouter } from '@lcdev/router';

// here, we have a folder (./routes) that contains many Routers
// `api` here conglomerates all of them into one single koa-router
const api = await createRouter(join(__dirname, 'routes'));

// you can use the router just like koa-router
const myServer = new Koa();
myServer.use(api.routes());
myServer.use(api.allowedMethods());
```

Cool! But what about those files in `./routes`? Let's look at their expected structure.

Below is a typescript file in the `routes` folder:

```typescript
import {
  RouteFactory,
  RouteActionWithContext,
  HttpMethod,
  route,
  bindRouteActions,
} from '@lcdev/router';

// we'll leave this blank for now
type Dependencies = {};

const factory: RouteFactory<Dependencies> = {
  getDependencies() {
    // here, we return whatever Dependencies is
    return {};
  },

  create(dependencies: Dependencies) {
    // here, bindRouteActions isn't required, but it adds `dependencies` as `this` for actions, which is useful
    return bindRouteActions(dependencies, [
      // here, route is optional (an object works), but it adds better type inference for later on
      route({
        path: '/hello-world',
        method: HttpMethod.GET,
        async action(ctx) {
          // returning here is the same as setting `ctx.body`
          return { hello: 'world!' };
        },
      }),
    ]);
  },
};

// important - default export needs to be a RouteFactory or a class implementing it
export default factory;
```

Alright, so we now have a 'RouteFactory', whatever that is. If this file was in `./routes`,
you'd now have a successful `/hello-world` GET route.

A few explanations:

1. We export a RouteFactory to make the router side-effect free
2. We define `Dependencies` so that you can be explicit about what other modules are used, usually this is a database connection or other integration

So on to dependencies.

```typescript
import {
  RouteFactory,
  RouteActionWithContext,
  HttpMethod,
  route,
  bindRouteActions,
} from '@lcdev/router';

type Dependencies = {
  // normally, you'd be a bit more concise and call this `kx` or `cx`
  databaseConnection: Postgres;
};

const factory: RouteFactory<Dependencies> = {
  getDependencies() {
    return {
      // we establish the database connection now - avoiding the need to unless actually using the router
      databaseConnection: getTheDefaultDatabaseConnection(),
    };
  },

  create(dependencies: Dependencies) {
    return bindRouteActions(dependencies, [
      route({
        path: '/some-entity',
        method: HttpMethod.GET,
        async action(ctx) {
          // we now have access to `databaseConnection` through `this`!

          // and we can return whatever we want, which will end up as a json response!
          return this.databaseConnection.query('select * from some_entity');
        },
      }),
    ]);
  },
};
```

The key here is, that `getDependencies` is solely a helper. For testing, you might forgo it entirely,
and `create` the router yourself with a mocked up database.

### Prefix
Prefixes get applied to all actions in a router. That means `prefix: '/auth'` puts all your actions after
that path prefix. You can forgo this and specify absolute paths in your actions if you want.

### Middleware
You can declare middleware for a router, and/or per route. This allows flexibility and coverage.

```typescript
const factory: RouteFactory<Dependencies> = {
  // your normal getDependencies and create functions
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
to your `action`.

```typescript
route({
  path: '/resource/:id',
  method: HttpMethod.POST,
  // we give you @lcdev/schema-builder through the `emptySchema` export
  // you can also using a json schema directly, using the `JSONSchema` export
  schema: emptySchema()
    .addNumber('x')
    .addNumber('y'),
  async action(_, body) {
    // here, typescript will actually know the type of x and y!
    const { x, y } = body;
  },
})
```

This does depend on having `bodyparser` middleware. We export `bodyparser`, for common use cases, from this module.

### Nesting
The lcdev router is usually used in mostly flat contexts, but you can easily nest your routers.

```typescript
import {
  RouteFactory,
  findRoutes,
} from '@lcdev/router';

const factory: RouteFactory<Dependencies> = {
  prefix: '/support',
  nested: () => findRoutes(join(__dirname, 'support')),

  getDependencies() { ... },
  create(dependencies: Dependencies) { ... },
};
```

The example above nests routes found in the `./support` folder.

### Errors
The lcdev router normalizes errors that come from your actions. This pairs nicely with `@lcdev/logger`.

What you need to know:

- `@lcdev/router` exports `BaseError`, which is "a user visible error"
- In development, you'll always see your error messages
- In production, only errors that are BaseErrors propagate up (see `internalMessage` for full details)

**Throwing errors**: it happens, you'll need a way to throw an error up when things go wrong.

```typescript
import { err } from '@lcdev/router';

// is it okay for your API consumers to see this error?
throw err(401, 'Your error message');

// no? keep it private by throwing any other error type
throw { status: 401, message: 'Your error message' };
```

You'll likely want to use `propagateErrors`, though it is, strictly speaking, optional.

```typescript
import { propagateErrors } from '@lcdev/router';

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

You're encouraged to add this middleware at the top of your app, as well as on every RouteFactory. Doing so
per-factory will make testing those factories in isolation a lot easier.

### Return Format
In a similar way to errors, it's handy to have all of your routes return JSON in the same structured format.

```json
{
  "success": true,
  "data": { ... }
}
```

Instead of doing this yourself, we have middleware to help. Again, this is optional but encouraged.

```typescript
import { propagateValues } from '@lcdev/router';

myServer.use(propagateValues());
```

When this middleware is above your route actions, you don't need to do anything. JSON responses will be wrapped
in the above format. This makes parsing your API responses a lot easier.

By default, this supports a third "meta" property in return objects. We normally use this for pagination state.
You can add data the `ctx.state.meta` or call `addMeta(ctx, { ... })` to fill this in in an action.

### Extracting Returns
Taking an example route action:

```typescript
route({
  path: '/users',
  method: HttpMethod.GET,
  async action(ctx) {
    return myDatabase.select('* from user');
  },
}),
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
route({
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
  async action(ctx) {
    return myDatabase.select('* from user');
  },
}),
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

This is pulled directly from the `@lcdev/mapper` package, you can read more there.

### API Fields
You might want to reduce the duplication when extracting return values. Most of the time,
you want to return the same fields for the same entities, records, etc.

Please see the [api-fields](https://gitlab.servalldatasystems.com/meat-n-potatoes/api-fields)
package for that. It defines a decorator, called `@ApiField()`, which you can use to automatically
fill in the `returning` field of a route action.

```typescript
import { ApiField } from '@lcdev/api-fields';

class User extends BaseEntity {
  @ApiField()
  id: number;

  privateField: number;

  @ApiField()
  firstName: string;

  // a closure means "get ApiFields for the Permission class"
  @ApiField(() => Permission)
  permission: Permission;

  ...
}
```

In your route action, simply:

```typescript
import { getApiFields } from '@lcdev/api-fields';

route({
  path: '/users/:id',
  method: HttpMethod.GET,
  // getApiFields returns an object with the same format that `returning` expects
  returning: getApiFields(User),
  async action(ctx) {
    return myDatabase.select('from user where id = $0', id);
  },
}),
```

### Open API
There is early support for generating API documentation from your routers. Check out the `createOpenAPI` function
for more about this. For now, we encourage you to use Insomnia for testing of APIs.
