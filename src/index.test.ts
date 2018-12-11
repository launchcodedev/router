import { HttpMethod, createRoutesWithCtx } from './index';

test('createRoutesWithCtx', () => {
  expect.assertions(1);
  const routes = createRoutesWithCtx({ foo: true }, [
    {
      path: '/',
      method: HttpMethod.GET,
      async action() {
        expect(true).toBe(true);
      },
    }
  ]);

  routes[0].action(null as any, null as any);
});
