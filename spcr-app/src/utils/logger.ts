const SENSITIVE_KEY_PATTERN =
  /secret|token|password|api_?key|authorization|cookie|encrypted_|body_text|extracted_text|raw/i;
const BEARER_OR_KEY_VALUE_PATTERN = /(gsk_[A-Za-z0-9_-]{10,}|ya29\.[A-Za-z0-9._-]+|1\/\/[A-Za-z0-9._-]+)/g;

export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TruncatedDepth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const masked = value.replace(BEARER_OR_KEY_VALUE_PATTERN, '[REDACTED_CREDENTIAL]');
    return masked.length > 500 ? `${masked.slice(0, 500)}...[truncated]` : masked;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `[BinaryBytes:${value.byteLength}]`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeForLog(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeForLog(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export const logger = {
  info(event: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'test' && process.env.SPCR_VERBOSE_TEST_LOGS !== 'true') return;
    const entry = {
      ts: new Date().toISOString(),
      level: 'info',
      service: 'SPCR',
      event,
      ...(meta ? { meta: sanitizeForLog(meta) } : {}),
    };
    console.log(JSON.stringify(entry));
  },
  warn(event: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'test' && process.env.SPCR_VERBOSE_TEST_LOGS !== 'true') return;
    const entry = {
      ts: new Date().toISOString(),
      level: 'warn',
      service: 'SPCR',
      event,
      ...(meta ? { meta: sanitizeForLog(meta) } : {}),
    };
    console.warn(JSON.stringify(entry));
  },
  error(event: string, meta?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'test' && process.env.SPCR_VERBOSE_TEST_LOGS !== 'true') return;
    const entry = {
      ts: new Date().toISOString(),
      level: 'error',
      service: 'SPCR',
      event,
      ...(meta ? { meta: sanitizeForLog(meta) } : {}),
    };
    console.error(JSON.stringify(entry));
  },
};

