import { extract } from '@servall/mapper';
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

export const extractApiFields = (target: any): any => {
  if (!target) {
    return target;
  }

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
