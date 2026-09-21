import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { itemInputSchema, itemSearchSchema } from './items.schema.js';
import { importBodySchema, importItems } from './items.import.js';
import {
  createItem, findByBarcode, getItem, getStockSummary, searchItems, updateItem, updateVariantPrice,
} from './items.service.js';

const idParam = z.object({ id: z.string().uuid('Invalid item id.') });

export async function itemRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', { preHandler: [requirePermission('item:view')] }, async (request) =>
    searchItems(itemSearchSchema.parse(request.query)),
  );

  // Totals for the whole shop, not just the page the list is showing.
  app.get('/summary', { preHandler: [requirePermission('item:view')] }, async () => ({
    data: await getStockSummary(),
  }));

  app.get('/barcode/:code', { preHandler: [requirePermission('item:view')] }, async (request) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(request.params);
    return { data: await findByBarcode(code) };
  });

  app.post('/import', { preHandler: [requirePermission('item:create')] }, async (request) => {
    const { rows } = importBodySchema.parse(request.body);
    return { data: await importItems(rows, request.user!.id) };
  });

  app.patch('/variants/:id/price', { preHandler: [requirePermission('item:update')] }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { selling_price, unit } = z
      .object({ selling_price: z.coerce.number().min(0).optional(), unit: z.string().min(1).max(20).optional() })
      .parse(request.body);
    return { data: await updateVariantPrice(id, selling_price, request.user!, unit) };
  });

  app.get('/:id', { preHandler: [requirePermission('item:view')] }, async (request) => {
    const { id } = idParam.parse(request.params);
    return { data: await getItem(id) };
  });

  app.post('/', { preHandler: [requirePermission('item:create')] }, async (request, reply) => {
    const body = itemInputSchema.parse(request.body);
    const item = await createItem(body, request.user!);
    return reply.code(201).send({ data: item });
  });

  app.put('/:id', { preHandler: [requirePermission('item:update')] }, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = itemInputSchema.parse(request.body);
    return { data: await updateItem(id, body, request.user!) };
  });
}
