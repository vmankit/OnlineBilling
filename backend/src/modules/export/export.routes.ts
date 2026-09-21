import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { buildWorkbook } from './export.service.js';

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/excel', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (_request, reply) => {
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="santu-hardware-data-${stamp}.xlsx"`)
      .send(await buildWorkbook());
  });
}
