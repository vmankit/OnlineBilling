import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { customerRoutes } from './modules/customers/customers.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { itemRoutes } from './modules/items/items.routes.js';
import { masterRoutes } from './modules/masters/masters.routes.js';
import { paymentRoutes } from './modules/payments/payments.routes.js';
import { purchaseRoutes } from './modules/purchases/purchases.routes.js';
import { expenseRoutes } from './modules/expenses/expenses.routes.js';
import { quotationRoutes } from './modules/quotations/quotations.routes.js';
import { reportRoutes } from './modules/reports/reports.routes.js';
import { returnRoutes } from './modules/returns/returns.routes.js';
import { salesRoutes } from './modules/sales/sales.routes.js';
import { stockRoutes } from './modules/stock/stock.routes.js';
import { supplierRoutes } from './modules/suppliers/suppliers.routes.js';
import { exportRoutes } from './modules/export/export.routes.js';
import { scheduleExcelMirror } from './modules/export/export.service.js';
import { whatsappRoutes } from './modules/whatsapp/whatsapp.routes.js';
import { AppError } from './utils/errors.js';
import { pool } from './db/pool.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.isProd
      ? { level: 'info' }
      : { level: 'info', transport: undefined },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin / curl / native app requests carry no Origin header.
      if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Origin not allowed by CORS policy.'), false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok', service: 'santu-hardware-api', time: new Date().toISOString() };
  });

  // Fastify snapshots the error handler for a child context when the plugin is
  // registered, so this MUST come before the API routes are mounted. Set it
  // afterwards and every /api error silently falls back to Fastify's default
  // envelope, where `error` is a string and the client finds no message.
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `No route for ${request.method} ${request.url}` },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.issues[0]?.message ?? 'Please check the highlighted fields.',
          fields: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }

    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }

    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a moment and try again.' },
      });
    }

    const pgCode = (error as { code?: string }).code;
    if (pgCode === '23505') {
      return reply.code(409).send({
        error: { code: 'CONFLICT', message: 'That record already exists.' },
      });
    }
    if (pgCode === '23503') {
      return reply.code(409).send({
        error: { code: 'CONFLICT', message: 'This record is referenced elsewhere and cannot be changed.' },
      });
    }

    // Anything unrecognised: full detail to the log, nothing to the client.
    request.log.error({ err: error }, 'Unhandled error');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
    });
  });


  // Keep the Excel copy in step with the database: any successful change refreshes it.
  app.addHook('onResponse', async (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'OPTIONS' && reply.statusCode < 400) {
      scheduleExcelMirror(env.excelMirrorDir, (m) => app.log.warn(m));
    }
  });
  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(itemRoutes, { prefix: '/items' });
      await api.register(customerRoutes, { prefix: '/customers' });
      await api.register(masterRoutes, { prefix: '/masters' });
      await api.register(salesRoutes, { prefix: '/sales' });
      await api.register(quotationRoutes, { prefix: '/quotations' });
      await api.register(paymentRoutes, { prefix: '/payments' });
      await api.register(dashboardRoutes, { prefix: '/dashboard' });
      await api.register(supplierRoutes, { prefix: '/suppliers' });
      await api.register(purchaseRoutes, { prefix: '/purchases' });
      await api.register(expenseRoutes, { prefix: '/expenses' });
      await api.register(stockRoutes, { prefix: '/stock' });
      await api.register(returnRoutes, { prefix: '/sales-returns' });
      await api.register(reportRoutes, { prefix: '/reports' });
      await api.register(whatsappRoutes, { prefix: '/whatsapp' });
      await api.register(exportRoutes, { prefix: '/export' });
    },
    { prefix: '/api' },
  );
  return app;
}
