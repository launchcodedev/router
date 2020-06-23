import { SchemaBuilder } from '@serafin/schema-builder';
import { Middleware, Context, err, addMeta } from './index';

export const paginationSchema = SchemaBuilder.emptySchema()
  .addString('page', { pattern: '^\\d+$' })
  .addString('count', { pattern: '^\\d+$' }, false);

const validationSchema = paginationSchema.addAdditionalProperties();

/**
 * Type of the `pagination` context state.
 */
export type Pagination = { page: number; pageSize: number; total?: number };

/**
 * Adds the resulting total count into context state - use with `paginate` middleware.
 */
export const addPagination = (ctx: Context, total: number) => {
  if (!ctx.state.pagination) {
    throw err(500, 'Called addPagination without wrapping pagination middleware');
  }

  ctx.state.pagination.total = total;
};

/**
 * Pagination middleware - add to your route action specifically.
 *
 * In the action, `ctx.state.pagination.total` (the resulting total number of results) must be set.
 * Use addPagination(ctx, total) in the action to do so automatically.
 */
export const paginate = (defaultCount: number, maxLimit = 1000): Middleware => async (
  ctx,
  next,
) => {
  try {
    validationSchema.validate(ctx.query);
  } catch {
    throw err(400, 'Query provided did not include correct page and/or pageSize for pagination');
  }

  const page = parseFloat(ctx.query.page);
  const pageSize = ctx.query.count ? parseFloat(ctx.query.count) : defaultCount;

  if (pageSize > maxLimit) {
    throw err(400, 'Pagination limit was too high');
  }

  if (Number.isNaN(page)) {
    throw err(400, 'Page provided was invalid');
  }

  if (page < 1) {
    throw err(400, 'Pagination page was < 1');
  }

  ctx.state.pagination = {
    page: page - 1,
    pageSize,
  } as Pagination;

  await next();

  if (!ctx.state.pagination) {
    throw err(500, 'Somehow, pagination state was deleted');
  }

  if (!('total' in ctx.state.pagination)) {
    throw err(500, 'Forgot to call addPagination in action wrapped by pagination middleware');
  }

  const { total } = ctx.state.pagination;

  addMeta(ctx, {
    total,
    pages: Math.ceil(total / pageSize),
  });
};
