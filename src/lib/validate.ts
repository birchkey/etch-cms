import { z } from 'zod';

export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const issue = result.error.issues[0];
  const msg = issue
    ? (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)
    : 'Invalid request body';
  return { ok: false, error: msg };
}
