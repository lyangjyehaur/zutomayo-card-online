import { isIP } from 'node:net';

export type ForwardedForValue = string | string[] | undefined;

function normalizeIp(value: string): string {
  const normalized = value
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%', 1)[0]
    .toLowerCase();
  const ipv4Mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return ipv4Mapped && isIP(ipv4Mapped[1]) === 4 ? ipv4Mapped[1] : normalized;
}

function ipv6Bytes(value: string): Uint8Array | null {
  const ip = normalizeIp(value);
  if (isIP(ip) !== 6) return null;
  let source = ip;
  if (source.includes('.')) {
    const suffix = source.slice(source.lastIndexOf(':') + 1);
    const parts = suffix.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    source = `${source.slice(0, source.lastIndexOf(':'))}:${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const halves = source.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const part = Number.parseInt(group, 16);
    bytes[index * 2] = part >>> 8;
    bytes[index * 2 + 1] = part & 0xff;
  });
  return bytes;
}

function ipBytes(value: string): Uint8Array | null {
  const ip = normalizeIp(value);
  if (isIP(ip) === 4) return Uint8Array.from(ip.split('.').map(Number));
  const bytes = ipv6Bytes(ip);
  if (!bytes) return null;
  const mapped = bytes.slice(0, 10).every((part) => part === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  return mapped ? bytes.slice(12) : bytes;
}

function ipMatchesRange(ip: string, range: string): boolean {
  const normalizedRange = normalizeIp(range);
  const slashIndex = normalizedRange.indexOf('/');
  const base = slashIndex >= 0 ? normalizedRange.slice(0, slashIndex) : normalizedRange;
  const candidateBytes = ipBytes(ip);
  const baseBytes = ipBytes(base);
  if (!candidateBytes || !baseBytes || candidateBytes.length !== baseBytes.length) return false;
  if (slashIndex < 0) return candidateBytes.every((part, index) => part === baseBytes[index]);
  const prefixLength = Number(normalizedRange.slice(slashIndex + 1));
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > candidateBytes.length * 8) return false;
  const wholeBytes = Math.floor(prefixLength / 8);
  const remainingBits = prefixLength % 8;
  for (let index = 0; index < wholeBytes; index += 1) {
    if (candidateBytes[index] !== baseBytes[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (candidateBytes[wholeBytes] & mask) === (baseBytes[wholeBytes] & mask);
}

export function resolveClientIp(
  remoteAddress: string | undefined,
  forwardedFor: ForwardedForValue,
  trustedProxyValue = process.env.TRUSTED_PROXY || '',
): string {
  const remoteIp = normalizeIp(remoteAddress || '');
  if (!remoteIp || isIP(remoteIp) === 0) return '';
  const trustedProxies = trustedProxyValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const trusted = (ip: string) => trustedProxies.some((range) => ipMatchesRange(ip, range));
  if (!trusted(remoteIp) || !forwardedFor) return remoteIp;

  const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const chain = value
    .split(',')
    .map(normalizeIp)
    .filter((ip) => isIP(ip) > 0);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (!trusted(chain[index])) return chain[index];
  }
  return chain[0] || remoteIp;
}
