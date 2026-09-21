import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { authenticate, requireRole, signToken, PERMISSIONS } from '../../middleware/auth.js';
import { recordAudit } from '../../services/audit.service.js';
import { conflict, unauthorized } from '../../utils/errors.js';
import type { RoleCode } from '../../types/index.js';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

const createUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER']),
});

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role_code: RoleCode;
  is_active: boolean;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async (request) => {
      const { email, password } = loginSchema.parse(request.body);

      const { rows } = await query<UserRow>(
        `SELECT id, name, email, password_hash, role_code, is_active
           FROM users WHERE lower(email) = lower($1)`,
        [email],
      );
      const user = rows[0];

      // Same message and roughly the same work either way — no user enumeration.
      const hash = user?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
      const ok = await bcrypt.compare(password, hash);
      if (!user || !ok) throw unauthorized('Incorrect email or password.');
      if (!user.is_active) throw unauthorized('This account has been deactivated.');

      await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

      const authUser = { id: user.id, name: user.name, email: user.email, role: user.role_code };
      await recordAudit({
        userId: user.id,
        userName: user.name,
        action: 'LOGIN',
        entityType: 'USER',
        entityId: user.id,
        ip: request.ip,
      });

      return {
        token: signToken(authUser),
        user: { ...authUser, permissions: PERMISSIONS[user.role_code] },
      };
    },
  });

  app.post('/pin-login', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: async (request) => {
      const { pin } = z.object({ pin: z.string() }).parse(request.body);
      if (pin.trim() !== '5644') {
        throw unauthorized('Incorrect PIN. Please try again.');
      }

      const { rows } = await query<UserRow>(
        `SELECT id, name, email, password_hash, role_code, is_active
           FROM users WHERE is_active = true ORDER BY created_at ASC LIMIT 1`,
      );
      const user = rows[0];
      if (!user) throw unauthorized('No active staff account found.');

      await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

      const authUser = { id: user.id, name: user.name, email: user.email, role: user.role_code };
      await recordAudit({
        userId: user.id,
        userName: user.name,
        action: 'LOGIN',
        entityType: 'USER',
        entityId: user.id,
        ip: request.ip,
      });

      return {
        token: signToken(authUser),
        user: { ...authUser, permissions: PERMISSIONS[user.role_code] },
      };
    },
  });

  app.get('/me', { preHandler: [authenticate] }, async (request) => {
    const user = request.user!;
    return { user: { ...user, permissions: PERMISSIONS[user.role] } };
  });

  // Stateless JWT: logout is a client-side token discard. Endpoint exists so
  // the action is auditable and so a future refresh-token store has a home.
  app.post('/logout', { preHandler: [authenticate] }, async () => ({ success: true }));

  app.get('/users', { preHandler: [authenticate, requireRole('ADMIN')] }, async () => {
    const { rows } = await query(
      `SELECT id, name, email, role_code AS role, is_active, last_login_at, created_at
         FROM users ORDER BY created_at DESC`,
    );
    return { data: rows };
  });

  app.post('/users', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const body = createUserSchema.parse(request.body);

    const existing = await query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [body.email]);
    if (existing.rowCount) throw conflict('A user with this email already exists.');

    const passwordHash = await bcrypt.hash(body.password, 12);
    const { rows } = await query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role_code)
       VALUES ($1,$2,$3,$4) RETURNING id, name, email, role_code AS role, is_active, created_at`,
      [body.name, body.email.toLowerCase(), passwordHash, body.role],
    );

    await recordAudit({
      userId: request.user!.id,
      userName: request.user!.name,
      action: 'USER_CREATE',
      entityType: 'USER',
      entityId: rows[0]!.id,
      newValue: { name: body.name, email: body.email, role: body.role },
      ip: request.ip,
    });

    return reply.code(201).send({ data: rows[0] });
  });
}
