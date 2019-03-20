import { Extraction } from '@servall/mapper';
import { Middleware } from './index';

const inject = (target: any, base = Object.getPrototypeOf(target)) => {
  if (!target.__apiFields) {
    // we inherit from a base class with __apiFields
    Object.defineProperty(target, '__apiFields', { value: new Set() });
  }

  if (base.__apiFields) {
    for (const name of base.__apiFields) {
      target.__apiFields.add(name);
    }
  }

  return target;
};

export const ApiField = () => function (klass: any, name: string) {
  const target = inject(klass.constructor);

  if (!target.__apiFields.has(name)) {
    target.__apiFields.add(name);
  }

  target.getApiFields = function getApiFields() {
    const extract: any = {};

    // TODO: use Object.fromEntries when landed in node
    target.__apiFields.forEach((f: string) => (extract[f] = true));

    return extract;
  };
};

export const getApiFields = (klass: any): Extraction => {
  if (klass) {
    if (klass.getApiFields) {
      return klass.getApiFields();
    } else if (klass.constructor.getApiFields) {
      return klass.constructor.getApiFields();
    }

    return {};
  }

  return {};
};
