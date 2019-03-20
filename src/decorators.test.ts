import { ApiField, getApiFields } from './decorators';
import { extract } from '@servall/mapper';

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
