export type RoleCode = 'ADMIN' | 'MANAGER' | 'CASHIER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: RoleCode;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}
