import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import type { AuthUser, RoleCode } from '../types/index.js';

export interface JwtPayload {
  sub: string;
  name: string;
  email: string;
  role: RoleCode;
}

export function signToken(user: AuthUser): string {
  const payload: JwtPayload = { sub: user.id, name: user.name, email: user.email, role: user.role };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

/** Verifies the bearer token and attaches `request.user`. */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized('Authentication required.');

  const token = header.slice('Bearer '.length).trim();
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    request.user = { id: decoded.sub, name: decoded.name, email: decoded.email, role: decoded.role };
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
}

/**
 * Route-level authorisation. Use after `authenticate`.
 *   preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')]
 */
export function requireRole(...roles: RoleCode[]) {
  return async function roleGuard(request: FastifyRequest): Promise<void> {
    if (!request.user) throw unauthorized();
    if (!roles.includes(request.user.role)) {
      throw forbidden(`This action requires the ${roles.join(' or ')} role.`);
    }
  };
}

/** Capability map — finer grained than roles, checked inside services. */
export const PERMISSIONS = {
  ADMIN: ['*'],
  MANAGER: [
    'sale:create', 'sale:cancel', 'sale:view',
    'item:create', 'item:update', 'item:view', 'item:cost',
    'customer:create', 'customer:update', 'customer:view',
    'purchase:create', 'purchase:view',
    'stock:adjust', 'stock:view',
    'payment:create', 'payment:view',
    'expense:create', 'expense:view',
    'report:view',
  ],
  CASHIER: [
    'sale:create', 'sale:view',
    'item:view',
    'customer:create', 'customer:view',
    'stock:view',
    'payment:create',
  ],
} as const satisfies Record<RoleCode, readonly string[]>;

export function can(role: RoleCode, permission: string): boolean {
  const list = PERMISSIONS[role] as readonly string[];
  return list.includes('*') || list.includes(permission);
}

export function requirePermission(permission: string) {
  return async function permissionGuard(request: FastifyRequest): Promise<void> {
    if (!request.user) throw unauthorized();
    if (!can(request.user.role, permission)) {
      throw forbidden(`Your role (${request.user.role}) cannot perform this action.`);
    }
  };
}
