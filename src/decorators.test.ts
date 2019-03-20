import { ApiField, extractApiFields } from './decorators';

test('api field', () => {
  class MyEntity {
    propertyA: boolean = true;
    propertyB: string = 'default';

    @ApiField()
    propertyC: number = 12;
  }

  const x = new MyEntity();
  expect((x as any).__apiFields).toEqual(new Set(['propertyC']));
});

test('extract api field', () => {
  class MyEntity {
    propertyA: boolean = true;
    propertyB: string = 'default';

    @ApiField()
    propertyC: number = 12;
  }

  const x = new MyEntity();
  expect(extractApiFields(x)).toEqual({ propertyC: 12 });
});

test('extract nested api fields', () => {
  class ChildEntity {
    @ApiField()
    propertyA: number = 101;
    propertyB: string = 'baz';
  }

  class MyEntity {
    propertyA: boolean = true;
    propertyB: string = 'default';

    @ApiField()
    propertyC: number = 12;

    @ApiField()
    propertyD: ChildEntity = new ChildEntity();
  }

  const x = new MyEntity();
  expect(extractApiFields(x)).toEqual({
    propertyC: 12,
    propertyD: {
      propertyA: 101,
    },
  });
});

test('extract plain object', () => {
  expect(extractApiFields({ foo: { bar: 'baz' } })).toEqual({ foo: { bar: 'baz' } });
});

test('extract plain string', () => {
  expect(extractApiFields('bar')).toEqual('bar');
});

test('base class', () => {
  class BaseClass {
    @ApiField()
    propertyA: string = 'a';
  }

  class MyEntity extends BaseClass {
    @ApiField()
    propertyB: string = 'b';
  }

  const x = new MyEntity();
  expect(extractApiFields(x)).toEqual({
    propertyA: 'a',
    propertyB: 'b',
  });
});
