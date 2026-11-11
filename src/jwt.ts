import { base64UrlDecode } from './pkce';

export interface DecodedJwt {
  header: unknown;
  payload: Record<string, unknown>;
}

export function decodeJwt(token: string): DecodedJwt | null {
  const [header, payload] = token.split('.');

  if (!header || !payload) {
    return null;
  }

  try {
    return { header: JSON.parse(base64UrlDecode(header)), payload: JSON.parse(base64UrlDecode(payload)) };
  } catch {
    return null;
  }
}

// Spryker puts the customer identity into `sub` as a JSON string.
export function parseSubject(payload: Record<string, unknown>): unknown {
  if (typeof payload.sub !== 'string') {
    return null;
  }

  try {
    const subject: unknown = JSON.parse(payload.sub);

    return typeof subject === 'object' ? subject : null;
  } catch {
    return null;
  }
}
