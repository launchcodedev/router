import { ApiField, ApiFields, extractApiFields } from './decorators';

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

test('api fields', () => {
  @ApiFields()
  class MyEntity {
    propertyA: boolean = true;
    propertyB: string = 'default';
    propertyC: number = 12;
  }

  const x = new MyEntity();
  expect((x as any).__apiFields).toEqual(new Set(['propertyA', 'propertyB', 'propertyC']));
});

test('api fields exclude', () => {
  @ApiFields({ exclude: ['propertyC'] })
  class MyEntity {
    propertyA: boolean = true;
    propertyB: string = 'default';
    propertyC: number = 12;
  }

  const x = new MyEntity();
  expect(((x as any).__apiFields)).toEqual(new Set(['propertyA', 'propertyB']));
});

test('api field exclude', () => {
  @ApiFields()
  class MyEntity {
    propertyA: boolean = true;
    propertyB: string = 'default';
    @ApiField({ exclude: true })
    propertyC: number = 12;
  }

  const x = new MyEntity();
  expect(((x as any).__apiFields)).toEqual(new Set(['propertyA', 'propertyB']));
});

test('api fields constructor', () => {
  @ApiFields()
  class MyEntity {
    a: number;
    b: number;
    constructor(a: number, b: number) {
      this.a = a;
      this.b = b;
    }
  }

  const x = new MyEntity(1, 2);
  expect(x.a).toBe(1);
  expect(x.b).toBe(2);
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

test('extract array of entity api fields', () => {
  @ApiFields()
  class ChildEntity {
    constructor(a: number) {
      this.propertyA = a;
    }

    propertyA: number;
    propertyB: string = 'baz';
  }

  class MyEntity {
    constructor(d: number) {
      this.propertyD = new ChildEntity(d);
    }

    propertyA: boolean = true;
    propertyB: string = 'default';

    @ApiField()
    propertyC: number = 12;

    @ApiField()
    propertyD: ChildEntity;
  }

  expect(extractApiFields([
    new MyEntity(1),
    new MyEntity(2),
    new MyEntity(3),
  ])).toEqual([
    {
      propertyC: 12,
      propertyD: {
        propertyA: 1,
        propertyB: 'baz',
      },
    },
    {
      propertyC: 12,
      propertyD: {
        propertyA: 2,
        propertyB: 'baz',
      },
    },
    {
      propertyC: 12,
      propertyD: {
        propertyA: 3,
        propertyB: 'baz',
      },
    },
  ]);
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

test('base class api fields', () => {
  @ApiFields()
  class BaseClass {
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

test('extend class api fields', () => {
  class BaseClass {
    @ApiField()
    propertyA: string = 'a';
  }

  @ApiFields()
  class MyEntity extends BaseClass {
    propertyB: string = 'b';
  }

  const x = new MyEntity();
  expect(extractApiFields(x)).toEqual({
    propertyA: 'a',
    propertyB: 'b',
  });
});

test('base class api fields on both', () => {
  @ApiFields()
  class BaseClass {
    propertyA: string = 'a';
  }

  @ApiFields()
  class MyEntity extends BaseClass {
    propertyB: string = 'b';
  }

  const x = new MyEntity();
  expect(extractApiFields(x)).toEqual({
    propertyA: 'a',
    propertyB: 'b',
  });
});

test('double inheritance', () => {
  @ApiFields()
  class BaseBaseClass {
    propertyA: string = 'a';
  }

  @ApiFields()
  class BaseClass extends BaseBaseClass {
    propertyB: string = 'b';
  }

  class MyEntity extends BaseClass {
    @ApiField()
    propertyC: string = 'c';
  }

  const x = new MyEntity();
  expect(extractApiFields(x)).toEqual({
    propertyA: 'a',
    propertyB: 'b',
    propertyC: 'c',
  });
});

test('exclude in base class', () => {
  class BaseClass {
    @ApiField({ exclude: true })
    propertyA: string = 'a';
  }

  @ApiFields()
  class MyEntity extends BaseClass {
    propertyB: string = 'b';
  }

  const x = new MyEntity();
  expect(extractApiFields(x)).toEqual({
    propertyB: 'b',
  });
});

test('exclude all in base class', () => {
  @ApiFields({ exclude: ['propertyA'] })
  class BaseClass {
    propertyA: string = 'a';
  }

  @ApiFields()
  class MyEntity extends BaseClass {
    propertyB: string = 'b';
  }

  const x = new MyEntity();
  expect(extractApiFields(x)).toEqual({
    propertyB: 'b',
  });
});

test('methods', () => {
  @ApiFields()
  class BaseClass {
    foo() {
      return 1;
    }
  }

  @ApiFields()
  class MyEntity extends BaseClass {
    bar()  {
      return 2;
    }
  }

  const x = new MyEntity();
  expect(x.foo()).toBe(1);
  expect(x.bar()).toBe(2);
});
