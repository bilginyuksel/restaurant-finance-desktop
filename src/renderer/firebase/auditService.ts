import { db } from './config';
import { AuditAction, AuditLog } from '../../shared/types';
import { User } from 'firebase/auth';
import { addDoc, collection } from 'firebase/firestore';

export interface RecordAuditPayload {
  action: AuditAction;
  entityId: string;
  entityName?: string;
  metadata?: Record<string, any>;
  before?: Record<string, any>;
  after?: Record<string, any>;
}

/**
 * Writes an AuditLog document to Firestore.
 * Fire-and-forget: never throws, never blocks the caller.
 */
export function recordAudit(
  restaurantId: string,
  user: User,
  payload: RecordAuditPayload,
): void {
  const entry: Omit<AuditLog, 'id'> = {
    action: payload.action,
    entityId: payload.entityId,
    entityName: payload.entityName,
    performedBy: user.uid,
    performedByEmail: user.email ?? 'unknown',
    performedByName: user.displayName || user.email || 'Unknown',
    timestamp: Date.now(),
    ...(payload.metadata ? { metadata: payload.metadata } : {}),
    ...(payload.before ? { before: payload.before } : {}),
    ...(payload.after ? { after: payload.after } : {}),
  };

  void addDoc(
    collection(db, 'restaurants', restaurantId, 'auditLogs'),
    entry,
  ).catch((err) =>
    console.error('[auditService] Failed to write audit log', payload.action, err),
  );
}
