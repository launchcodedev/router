import { Middleware } from './index';

const inject = (target: any) => {
  if (!target.__apiFields) {
    // we need a specific exclude property so that @ApiField({ exclude }) can override @ApiFields()
    Object.defineProperty(target, '__apiFields', { value: new Set() });
    Object.defineProperty(target, '__apiExcludeFields', { value: new Set() });
  }

  return target;
};

export const ApiField = ({ exclude = false } = {}) => function (target: any, name: string) {
  inject(target);

  if (exclude) {
    target.__apiFields.delete(name);
    target.__apiExcludeFields.add(name);
  } else if (!target.__apiExcludeFields.has(name)) {
    target.__apiFields.add(name);
  }
};

type ApiFieldsOptions = {
  exclude?: string[];
};

export const ApiFields = ({ exclude = [] }: ApiFieldsOptions = {}) => function (Class: any): any {
  // we wrap the original class, but adding __apiFields after the constructor is called
  const Wrapped = function (...args: any[]) {
    const instance = inject(new Class(...args));

    for (const name of Object.keys(instance)) {
      if (!exclude.includes(name) && !instance.__apiExcludeFields.has(name)) {
        instance.__apiFields.add(name);
      }
    }

    return instance;
  };

  Wrapped.prototype = Class.prototype;

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
    if (target[field].__apiFields) {
      result[field] = extractApiFields(target[field]);
    } else {
      result[field] = target[field];
    }
  }

  return result;
};

export const extractApiFieldsMiddleware = (): Middleware => async (ctx, next) => {
  await next();

  if (ctx.body) {
    ctx.body = extractApiFields(ctx.body);
  }
};
