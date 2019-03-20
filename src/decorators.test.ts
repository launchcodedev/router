import { routerTest } from '@servall/router-testing';
import * as bodyparser from 'koa-bodyparser';
import { extract } from '@servall/mapper';
import { ApiField, getApiFields } from './decorators';
import {
  RouteFactory,
  HttpMethod,
  bindRouteActions,
  propagateErrors,
} from './index';

test('api field', () => {
  class MyEntity {
    propertyA: boolean = true;
    propertyB: string = 'default';

    @ApiField()
    propertyC: number = 12;
  }

  expect(getApiFields(MyEntity)).toEqual({ propertyC: true });
  expect(extract(new MyEntity(), getApiFields(MyEntity))).toEqual({ propertyC: 12 });
});

test('api field nested', () => {
  class MyOtherEntity {
    @ApiField()
    propertyA: boolean = true;
    propertyB: string = 'default';
  }

  class MyEntity {
    propertyA: boolean = true;
    propertyB: string = 'default';

    @ApiField()
    propertyC: number = 12;

    @ApiField(MyOtherEntity)
    other?: MyOtherEntity = new MyOtherEntity();
  }

  expect(getApiFields(MyEntity)).toEqual({ propertyC: true, other: { propertyA: true } });
  expect(extract(new MyEntity(), getApiFields(MyEntity)))
    .toEqual({
      propertyC: 12,
      other: {
        propertyA: true,
      },
    });
});

test('api field in returning', async () => {
  class MyEntity {
    propertyA: boolean = true;

    @ApiField()
    propertyB: string = 'default';

    @ApiField()
    propertyC: number = 12;
  }

  const factory: RouteFactory<{}> = {
    getDependencies() {
      return {};
    },

    middleware() {
      return [
        bodyparser(),
        propagateErrors(),
      ];
    },

    create(dependencies: {}) {
      return [
        {
          path: '/test',
          method: HttpMethod.GET,
          async action(ctx, next) {
            return new MyEntity();
          },
          returning: getApiFields(MyEntity),
        },
      ];
    },
  };

  await routerTest(factory, {}, async (test) => {
    await test.get('/test')
      .expect({
        // note no propertyA
        propertyB: 'default',
        propertyC: 12,
      });
  });
});
