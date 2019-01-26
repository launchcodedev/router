import { Middleware } from './index';

const inject = (target: any, base = Object.getPrototypeOf(target)) => {
  if (!target.__apiFields) {
    // we inherit from a base class with __apiFields
    Object.defineProperty(target, '__apiFields', { value: new Set() });
    Object.defineProperty(target, '__apiExcludeFields', { value: new Set() });
  }

  if (base.__apiFields) {
    for (const name of base.__apiFields) {
      target.__apiFields.add(name);
    }

    for (const name of base.__apiExcludeFields) {
      target.__apiFields.delete(name);
      target.__apiExcludeFields.add(name);
    }
  }

  return target;
};

export const ApiField = ({ exclude = false } = {}) => function (target: any, name: string) {
  inject(target);

  if (exclude) {
    target.__apiFields.delete(name);
    target.__apiExcludeFields.add(name);
  } else if (!target.__apiExcludeFields.has(name) && !target.__apiFields.has(name)) {
    target.__apiFields.add(name);
  }
};

type ApiFieldsOptions = {
  exclude?: string[];
};

export const ApiFields = ({ exclude = [] }: ApiFieldsOptions = {}) => function (Class: any): any {
  // we wrap the original class, but adding __apiFields after the constructor is called
  const Wrapped = function (this: any, ...args: any[]) {
    const instance = inject(this, new Class(...args));

    for (const name of Object.keys(instance)) {
      if (exclude.includes(name) || instance.__apiExcludeFields.has(name)) {
        instance.__apiFields.delete(name);
        instance.__apiExcludeFields.add(name);
      } else if (!instance.__apiFields.has(name)) {
        instance.__apiFields.add(name);
      }
    }

    return instance;
  };

  Wrapped.prototype = Object.create(Class.prototype);

  return Wrapped;
};

export const extractApiFields = (target: any): any => {
  if (Array.isArray(target)) {
    return target.map(extractApiFields);
  }

  if (!target.__apiFields) {
    return target;
  }

  const result: any = {};
  for (const field of target.__apiFields) {
    result[field] = extractApiFields(target[field]);
  }

  return result;
};

export const extractApiFieldsMiddleware = (): Middleware => async (ctx, next) => {
  await next();

  if (ctx.body) {
    ctx.body = extractApiFields(ctx.body);
  }
};
