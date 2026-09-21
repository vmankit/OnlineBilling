import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@santuhardware.in'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin@12345'),
  // Comma-separated 10-digit mobile numbers. When set, WhatsApp will send to
  // these numbers and refuse every other one. Used while testing, so a demo
  // customer's number (which may belong to a real person) can never be messaged.
  WHATSAPP_ALLOWED_NUMBERS: z.string().default(''),
  /** Folder where an Excel copy of all data is kept up to date. Empty = no automatic copy. */
  EXCEL_MIRROR_DIR: z.string().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  excelMirrorDir: parsed.data.EXCEL_MIRROR_DIR.trim() || undefined,
  whatsappAllowedNumbers: parsed.data.WHATSAPP_ALLOWED_NUMBERS.split(',')
    .map((n) => n.replace(/\D/g, '').slice(-10))
    .filter((n) => n.length === 10),
  isProd: parsed.data.NODE_ENV === 'production',
};

export type Env = typeof env;
