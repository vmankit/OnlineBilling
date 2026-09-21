import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requirePermission, requireRole } from '../../middleware/auth.js';
import { cancelSaleSchema, createSaleSchema, listSalesSchema } from './sales.schema.js';
import { cancelSale, comparePrices, createSale, getSale, listSales } from './sales.service.js';
import { autoSendSale } from '../whatsapp/notify.service.js';

const idParam = z.object({ id: z.string().uuid('Invalid invoice id.') });

const priceCheckSchema = z.object({
  items: z.array(z.object({ variant_id: z.string().uuid(), rate: z.coerce.number().min(0) })),
});

export async function salesRoutes(app: FastifyInstance): Promise<void> {
  // Public invoice viewer endpoint (no auth token required — for WhatsApp bill link)
  app.get('/public/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    return { data: await getSale(id) };
  });

  app.addHook('preHandler', async (request, reply) => {
    if (request.routerPath?.endsWith('/public/:id')) {
      return;
    }
    await authenticate(request, reply);
  });

  app.get('/', { preHandler: [requirePermission('sale:view')] }, async (request) =>
    listSales(listSalesSchema.parse(request.query)),
  );

  app.get('/:id', { preHandler: [requirePermission('sale:view')] }, async (request) => {
    const { id } = idParam.parse(request.params);
    return { data: await getSale(id) };
  });

  app.post('/', { preHandler: [requirePermission('sale:create')] }, async (request, reply) => {
    const body = createSaleSchema.parse(request.body);
    const id = await createSale(body, request.user!, request.ip);
    // After the sale has committed and without waiting on it: a phone that is
    // offline or unlinked must never hold up or fail the counter's bill.
    void autoSendSale(id).catch((err: Error) =>
      request.log.warn({ err: err.message, saleId: id }, 'WhatsApp auto-send failed'),
    );
    return reply.code(201).send({ data: await getSale(id) });
  });

  /**
   * Reports lines whose master price has moved since the bill was held or
   * quoted. The POS shows the operator the difference and makes them choose;
   * nothing is silently repriced.
   */
  app.post('/price-check', { preHandler: [requirePermission('sale:create')] }, async (request) => {
    const { items } = priceCheckSchema.parse(request.body);
    return { data: await comparePrices(items) };
  });

  // Cancelling keeps the invoice on file and reverses stock — never a delete.
  app.post('/:id/cancel', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { reason } = cancelSaleSchema.parse(request.body);
    await cancelSale(id, reason, request.user!, request.ip);
    return { data: await getSale(id) };
  });
}
