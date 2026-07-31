const MAX_SERVER_ERROR_LENGTH = 300;

export class OnlineHttpError extends Error {
  readonly status: number;
  readonly requestId?: string;

  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = 'OnlineHttpError';
    this.status = status;
    this.requestId = requestId;
  }
}

function serverErrorMessage(responseText: string): string {
  if (!responseText) return '';
  try {
    const parsed = JSON.parse(responseText) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === 'string') return parsed.error.trim();
    if (typeof parsed.message === 'string') return parsed.message.trim();
  } catch {
    // Some game-server errors are intentionally returned as plain text.
  }
  return responseText;
}

export async function onlineHttpError(response: Response, action: string): Promise<OnlineHttpError> {
  let responseText = '';
  try {
    responseText = (await response.text()).trim();
  } catch {
    // Preserve the HTTP metadata even when the response body cannot be read.
  }
  const requestId = response.headers?.get('x-request-id')?.trim() || undefined;
  const detail = serverErrorMessage(responseText).slice(0, MAX_SERVER_ERROR_LENGTH) || `${action} failed`;
  return new OnlineHttpError(
    `${detail} (HTTP ${response.status}${requestId ? `, request ${requestId}` : ''})`,
    response.status,
    requestId,
  );
}

export function onlineErrorDetail(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
