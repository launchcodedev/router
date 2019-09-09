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
  function ApiFieldDecorator(klass: any, name: string) {
    const target = inject(klass.constructor);

    target.__apiFields[name] = fieldType === undefined ? true : fieldType;

    target.getApiFields = function(seen: any[] = []) {
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
            extract[name] = [getApiFields(nested[0], undefined, seen)];
          } else {
            // @ApiField(() => Type)
            extract[name] = getApiFields(nested, undefined, seen);
          }
        }
      });

      return extract;
    };
  };

export const getApiFields = (
  klass: any,
  and?: object,
  seen: any[] = [],
): { [key: string]: Extraction } => {
  let fields = {};

  if (klass) {
    // short circuit if we've seen this class / entity before while recursing
    if (seen.includes(klass) || seen.includes(klass.constructor)) {
      // seen isn't part of the public api, it's only used in recursion
      return false as any;
    }

    if (klass.getApiFields) {
      fields = klass.getApiFields(seen.concat(klass));
    }

    if (klass.constructor.getApiFields) {
      fields = klass.constructor.getApiFields(seen.concat(klass.constructor));
    }
  }

  return merge(fields, and || {});
};
