import { Extraction } from '@servall/mapper';
import { Middleware } from './index';

type PrivateApiFields = { [key: string]: true | (() => Function) };

const inject = (target: any, base = Object.getPrototypeOf(target)) => {
  target.__apiFields = {
    ...(base.__apiFields || {}),
    ...(target.__apiFields || {}),
  };

  return target;
};

export const ApiField = (fieldType?: () => Function) => function (klass: any, name: string) {
  const target = inject(klass.constructor);

  if (!target.__apiFields[name]) {
    target.__apiFields[name] = fieldType ? fieldType : true;
  }

  target.getApiFields = function () {
    const extract: any = {};

    Object.entries(target.__apiFields as PrivateApiFields).forEach(([name, val]) => {
      extract[name] = val === true ? true : getApiFields(val());
    });

    return extract;
  };
};

export const getApiFields = (klass: any): { [key: string]: Extraction } => {
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
