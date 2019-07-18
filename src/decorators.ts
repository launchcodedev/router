/* eslint-disable no-underscore-dangle */
import { merge } from 'lodash';
import { Extraction } from '@servall/mapper';

type PrivateApiFields = { [key: string]: true | (() => Function) };

const inject = (target: any, base = Object.getPrototypeOf(target)) => {
  target.__apiFields = {
    ...(base.__apiFields || {}),
    ...(target.__apiFields || {}),
  };

  return target;
};

export const ApiField = (fieldType?: Extraction | (() => Function | [Function])) =>
  function(klass: any, name: string) {
    const target = inject(klass.constructor);

    if (!target.__apiFields[name]) {
      target.__apiFields[name] = fieldType || true;
    }

    target.getApiFields = function() {
      const extract: any = {};

      Object.entries(target.__apiFields as PrivateApiFields).forEach(([name, val]) => {
        if (val === true) {
          extract[name] = true;
        } else {
          // @ApiField({ foo: true })
          if (typeof val !== 'function') {
            extract[name] = val;
            return;
          }

          const nested = val();

          if (Array.isArray(nested) && nested.length === 1) {
            // @ApiField(() => [Type]) for array mapping is special
            extract[name] = [getApiFields(nested[0])];
          } else {
            // @ApiField(() => Type)
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
