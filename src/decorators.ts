import { merge } from 'lodash';
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

export const getApiFields = (klass: any, and?: object): { [key: string]: Extraction } => {
  let fields = {};

  if (klass) {
    if (klass.getApiFields) {
      fields = klass.getApiFields();
    }

    if (klass.constructor.getApiFields) {
      fields = klass.constructor.getApiFields();
    }
  }

  return merge(fields, and || {});
};
