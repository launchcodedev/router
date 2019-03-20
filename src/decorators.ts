import { Extraction } from '@servall/mapper';
import { Middleware } from './index';

const inject = (target: any, base = Object.getPrototypeOf(target)) => {
  if (!target.__apiFields) {
    // we inherit from a base class with __apiFields
    Object.defineProperty(target, '__apiFields', { value: {} });
  }

  if (base.__apiFields) {
    Object.assign(target.__apiFields, base.__apiFields, target.__apiFields);
  }

  return target;
};

export const ApiField = (fieldType?: Function) => function (klass: any, name: string) {
  const target = inject(klass.constructor);

  if (!target.__apiFields[name]) {
    target.__apiFields[name] = fieldType || true;
  }

  target.getApiFields = function () {
    const extract: any = {};

    Object.entries(target.__apiFields).forEach(([name, val]) => {
      extract[name] = val === true ? true : getApiFields(val);
    });

    return extract;
  };
};

export const getApiFields = (klass: any): Extraction => {
  if (klass) {
    if (klass.getApiFields) {
      return klass.getApiFields();
    }

    if (klass.constructor.getApiFields) {
      return klass.constructor.getApiFields();
    }

    return {};
  }

  return {};
};
