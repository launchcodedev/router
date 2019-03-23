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

export const ApiField = (fieldType?: () => Function | [Function]) =>
  function (klass: any, name: string) {
    const target = inject(klass.constructor);

    if (!target.__apiFields[name]) {
      target.__apiFields[name] = fieldType ? fieldType : true;
    }

    target.getApiFields = function () {
      const extract: any = {};

      Object.entries(target.__apiFields as PrivateApiFields).forEach(([name, val]) => {
        if (val === true) {
          extract[name] = true;
        } else {
          const nested = val();

          // @ApiField(() => [Type]) for array mapping is special
          if (Array.isArray(nested) && nested.length === 1) {
            extract[name] = [getApiFields(nested[0])];
          } else {
            extract[name] = getApiFields(nested);
          }
        }
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
