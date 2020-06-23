import { routerTest } from '@lcdev/router-testing';
import { paginate, addPagination, paginationSchema, Pagination } from './pagination';
import {
  RouteFactory,
  HttpMethod,
  route,
  propagateErrors,
  propagateValues,
  bodyparser,
} from './index';

describe('pagination', () => {
  test('basic', async () => {
    const dummyData = (n: number) => {
      return Array(n)
        .fill(null)
        .map(() => ({ foo: 'bar' }));
    };

    const factory: RouteFactory<{}> = {
      getDependencies() {
        return {};
      },

      middleware() {
        return [bodyparser(), propagateErrors(true), propagateValues()];
      },

      create() {
        return [
          route({
            path: '/',
            method: HttpMethod.GET,
            middleware: [paginate(100)],
            querySchema: paginationSchema,
            async action(ctx) {
              const { page, pageSize } = ctx.state.pagination as Pagination;

              const total = 105;
              const offset = page * pageSize;
              const onPage = Math.min(total - offset, pageSize);
              const results = dummyData(onPage);

              addPagination(ctx, total);

              return results;
            },
          }),
        ];
      },
    };

    await routerTest(factory, await factory.getDependencies(), async test => {
      await test.get('/').expect(400);
      await test
        .get('/?page=1')
        .expect(200)
        .expect({ success: true, meta: { total: 105, pages: 2 }, data: dummyData(100) });
      await test
        .get('/?page=2')
        .expect(200)
        .expect({ success: true, meta: { total: 105, pages: 2 }, data: dummyData(5) });
      await test
        .get('/?page=1&count=50')
        .expect(200)
        .expect({ success: true, meta: { total: 105, pages: 3 }, data: dummyData(50) });
      await test
        .get('/?page=3&count=50')
        .expect(200)
        .expect({ success: true, meta: { total: 105, pages: 3 }, data: dummyData(5) });
      await test
        .get('/?page=1&count=10')
        .expect(200)
        .expect({ success: true, meta: { total: 105, pages: 11 }, data: dummyData(10) });
    });
  });
});
