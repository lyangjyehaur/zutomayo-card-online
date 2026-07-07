/* global module */

/**
 * Validate a request body against a zod schema.
 * @param {import('zod').ZodTypeAny} schema
 * @param {unknown} body
 * @returns {{ ok: true, data: any } | { ok: false, errors: Array<{ path: string, message: string }> }}
 */
function validateBody(schema, body) {
  const result = schema.safeParse(body);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path),
      message: issue.message,
    })),
  };
}

module.exports = { validateBody };
