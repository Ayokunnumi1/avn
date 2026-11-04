import type { Db } from '@avn/database';
import { deps } from '../container';
import type { AuthContext } from './auth-context';

export interface AuditActor {
  auth?: AuthContext;
  ip?: string;
  userAgent?: string;
  system?: string;
}

/**
 * Append-only audit trail for sensitive operations (spec 1.1 #11, Part 12 #20/#24).
 * Pass the transaction client so the audit row commits atomically with the change.
 */
export async function audit(
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata?: Record<string, unknown>,
  opts: { organisationId?: string | null; db?: Db } = {},
): Promise<void> {
  const db = opts.db ?? deps().prisma;
  const auth = actor.auth;
  await db.auditEvent.create({
    data: {
      actorUserId: auth?.user?.id ?? null,
      actorType: actor.system ? 'SYSTEM' : auth?.kind === 'apiKey' ? 'API_KEY' : auth?.user ? auth.user.accountType : 'ANONYMOUS',
      actorLabel: actor.system ?? auth?.user?.fullName ?? auth?.apiKey?.prefix ?? null,
      action,
      entityType,
      entityId,
      organisationId: opts.organisationId ?? auth?.org?.id ?? auth?.apiKey?.organisationId ?? null,
      ipAddress: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      metadata: (metadata ?? undefined) as object | undefined,
    },
  });
}

export const actorFrom = (ctx: { auth: AuthContext; ip: string; userAgent: string }): AuditActor => ({
  auth: ctx.auth,
  ip: ctx.ip,
  userAgent: ctx.userAgent,
});
export const SYSTEM = (name: string): AuditActor => ({ system: name });
