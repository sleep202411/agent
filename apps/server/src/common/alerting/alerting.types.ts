export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface AlertEvent {
  kind: string;
  severity: AlertSeverity;
  source: string;
  title: string;
  summary?: string;
  fingerprint?: string;
  occurredAt?: string;
  request?: {
    method?: string;
    path?: string;
    statusCode?: number;
    requestId?: string;
    userAgent?: string;
    ip?: string;
  };
  error?: {
    code?: string;
    name?: string;
    message?: string;
    stack?: string;
  };
  context?: Record<string, unknown>;
  tags?: string[];
}
