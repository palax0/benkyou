import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export const TRANSCRIBE_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB runaway/mislabeled-content guard
const PROBE_TIMEOUT_MS = 30_000;

export function assertHttpUrl(rawUrl: string): URL {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error(`Invalid media URL: ${rawUrl}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Refusing non-http(s) media URL scheme: ${u.protocol}`);
  }
  return u;
}

// Convert a dotted-decimal IPv4 string to a uint32 for mask comparison.
function ipv4ToUint32(ip: string): number {
  const parts = ip.split('.');
  return (
    ((Number(parts[0]) << 24) |
     (Number(parts[1]) << 16) |
     (Number(parts[2]) << 8) |
      Number(parts[3])) >>> 0
  );
}

// Check a uint32 IPv4 address against a CIDR prefix (network, prefixLen).
function inCidrV4(ip32: number, network: number, prefixLen: number): boolean {
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ip32 & mask) === (network & mask);
}

// Expand an IPv6 address string (including ::ffff:x.x.x.x textual form and compressed ::)
// to a 16-byte Uint8Array. Returns null if unparseable.
function expandIPv6(ip: string): Uint8Array | null {
  // Handle ::ffff:a.b.c.d textual form (mixed notation) — convert the embedded IPv4 to hex.
  const mixedMatch = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mixedMatch) {
    const v4parts = mixedMatch[1]!.split('.').map(Number);
    if (v4parts.some((p) => p < 0 || p > 255 || !Number.isInteger(p))) return null;
    const bytes = new Uint8Array(16);
    bytes[10] = 0xff; bytes[11] = 0xff;
    bytes[12] = v4parts[0]!; bytes[13] = v4parts[1]!;
    bytes[14] = v4parts[2]!; bytes[15] = v4parts[3]!;
    return bytes;
  }

  // Split on :: to handle compressed zeros.
  const sides = ip.split('::');
  if (sides.length > 2) return null; // invalid: more than one ::

  const left = sides[0] ? sides[0].split(':') : [];
  const right = sides.length === 2 && sides[1] ? sides[1].split(':') : [];
  const totalGroups = left.length + right.length;
  if (totalGroups > 8) return null;

  const groups: number[] = [
    ...left.map((g) => parseInt(g, 16)),
    ...Array<number>(8 - totalGroups).fill(0), // fill compressed zeros
    ...right.map((g) => parseInt(g, 16)),
  ];

  if (groups.some((g) => isNaN(g) || g < 0 || g > 0xffff)) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i]! >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i]! & 0xff;
  }
  return bytes;
}

// Check a 16-byte IPv6 address against a prefix (given as the first prefixLen bits).
function inCidrV6(bytes: Uint8Array, prefix: Uint8Array, prefixLen: number): boolean {
  const fullBytes = Math.floor(prefixLen / 8);
  for (let i = 0; i < fullBytes; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  const rem = prefixLen % 8;
  if (rem > 0) {
    const mask = 0xff & (0xff << (8 - rem));
    if ((bytes[fullBytes]! & mask) !== (prefix[fullBytes]! & mask)) return false;
  }
  return true;
}

// Pure predicate — no I/O — checks whether an IP string falls in a private/internal range.
// Covers IPv4 private/loopback/CGNAT/link-local, IPv6 loopback/ULA/link-local,
// and IPv4-mapped IPv6 (::ffff:a.b.c.d) by stripping the embedded IPv4 and re-checking.
export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    const ip32 = ipv4ToUint32(ip);
    return (
      inCidrV4(ip32, ipv4ToUint32('0.0.0.0'),     8)  ||  // 0.0.0.0/8
      inCidrV4(ip32, ipv4ToUint32('10.0.0.0'),    8)  ||  // 10.0.0.0/8
      inCidrV4(ip32, ipv4ToUint32('100.64.0.0'), 10)  ||  // 100.64.0.0/10 (CGNAT)
      inCidrV4(ip32, ipv4ToUint32('127.0.0.0'),   8)  ||  // 127.0.0.0/8 (loopback)
      inCidrV4(ip32, ipv4ToUint32('169.254.0.0'), 16) ||  // 169.254.0.0/16 (link-local)
      inCidrV4(ip32, ipv4ToUint32('172.16.0.0'), 12)  ||  // 172.16.0.0/12
      inCidrV4(ip32, ipv4ToUint32('192.168.0.0'), 16)     // 192.168.0.0/16
    );
  }

  if (version === 6) {
    // Strip IPv6 brackets that may appear in URL hostnames (e.g. [::1]).
    const stripped = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
    const bytes = expandIPv6(stripped);
    if (!bytes) return false;

    // IPv4-mapped IPv6 (::ffff:0:0/96): extract embedded IPv4 and apply IPv4 rules.
    // Prefix for ::ffff:0:0/96 is bytes 0-9 = 0x00, bytes 10-11 = 0xff.
    const isV4Mapped =
      bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0 &&
      bytes[4] === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0 &&
      bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0xff && bytes[11] === 0xff;
    if (isV4Mapped) {
      const embedded = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
      return isBlockedAddress(embedded);
    }

    // ::/128 — unspecified
    const allZero = bytes.every((b) => b === 0);
    if (allZero) return true;

    // ::1/128 — loopback
    const isLoopback = bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1;
    if (isLoopback) return true;

    // fc00::/7 — ULA (covers fc00:: and fd00::)
    const fcPrefix = new Uint8Array([0xfc]);
    if (inCidrV6(bytes, fcPrefix, 7)) return true;

    // fe80::/10 — link-local
    const fePrefix = new Uint8Array([0xfe, 0x80]);
    if (inCidrV6(bytes, fePrefix, 10)) return true;

    return false;
  }

  return false;
}

// Async SSRF guard: resolves hostname via DNS and checks all returned IPs.
// NOTE: This guard checks DNS resolution at call time. A DNS-rebind TOCTOU attack
// (where DNS changes between this check and the actual network call) is out of scope —
// mitigating it would require a DNS-pinning proxy or egress firewall, both beyond the
// self-hosted deployment model of this project.
export async function assertSafeHttpUrl(rawUrl: string): Promise<URL> {
  const u = assertHttpUrl(rawUrl); // validates scheme + parseable

  // Strip brackets from IPv6 literals in hostnames (URL spec wraps them in []).
  const rawHost = u.hostname;
  const hostForIsIP = rawHost.startsWith('[') && rawHost.endsWith(']')
    ? rawHost.slice(1, -1)
    : rawHost;

  if (isIP(hostForIsIP) !== 0) {
    // Host is already an IP literal — check it directly without DNS.
    if (isBlockedAddress(hostForIsIP)) {
      throw new Error(`Refusing media URL resolving to a private/internal address: ${hostForIsIP}`);
    }
    return u;
  }

  // Hostname — resolve via DNS then check all returned addresses.
  const resolved = await lookup(rawHost, { all: true });
  if (!resolved || resolved.length === 0) {
    throw new Error(`Media URL hostname did not resolve: ${rawHost}`);
  }
  for (const record of resolved) {
    if (isBlockedAddress(record.address)) {
      throw new Error(
        `Refusing media URL resolving to a private/internal address: ${record.address}`,
      );
    }
  }

  return u;
}

// ffprobe reads only headers / the moov atom (a few hundred KB) over the network.
// Returns null when the URL resolves but is not parseable media (→ caller degrades to
// unavailable). Throws on a transient failure (→ caller's extract retry consumes attempts).
// assertSafeHttpUrl can also throw a PERMANENT rejection (blocked address / bad scheme)
// that is not transient and should not be retried.
// SSRF guard runs via assertSafeHttpUrl before any network/child-process call.
export async function probeRemoteDurationSec(mediaUrl: string): Promise<number | null> {
  await assertSafeHttpUrl(mediaUrl);
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error', '-probesize', '5M', '-analyzeduration', '5M',
      '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mediaUrl,
    ];
    const proc = spawn('ffprobe', args, { timeout: PROBE_TIMEOUT_MS });
    let out = ''; let err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', reject); // ffprobe binary missing → transient/infra error
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.slice(0, 500)}`));
      const secs = Number(out.trim());
      resolve(Number.isFinite(secs) && secs > 0 ? Math.round(secs) : null);
    });
  });
}

// Streaming download with a hard byte ceiling that aborts even if Content-Length lied.
// Redirects are followed manually — each hop is re-validated against the IP denylist via
// assertSafeHttpUrl, closing the redirect-to-metadata bypass (SSRF via 302 to internal IP).
// Capped at 5 hops. Caller MUST call cleanup() in finally.
export async function downloadToTmp(mediaUrl: string, maxBytes = TRANSCRIBE_MAX_BYTES): Promise<{ path: string; cleanup: () => Promise<void> }> {
  let current: URL = await assertSafeHttpUrl(mediaUrl);
  let res: Response;
  for (let hop = 0; ; hop++) {
    if (hop > 5) throw new Error('Media download exceeded redirect cap');
    res = await fetch(current, { redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) break; // not a redirect → final response
    const loc = res.headers.get('location');
    if (!loc) break; // 3xx without Location → treat as final, let the ok/body check below handle it
    current = await assertSafeHttpUrl(new URL(loc, current).toString()); // re-validate each redirect target (resolves relative Location)
  }
  if (!res!.ok || !res!.body) throw new Error(`Media download failed: ${res!.status} ${res!.statusText}`);
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Media exceeds byte ceiling (Content-Length ${declared} > ${maxBytes})`);
  }
  const dir = await mkdtemp(join(tmpdir(), 'benkyou-transcribe-'));
  const path = join(dir, 'media');
  const cleanup = async (): Promise<void> => { await rm(dir, { recursive: true, force: true }); };
  try {
    let total = 0;
    const counting = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) throw new Error(`Media stream exceeded byte ceiling at ${total} bytes`);
        controller.enqueue(chunk);
      },
    });
    // Cast needed: lib:ES2023 (no DOM) ReadableStream lacks values/asyncIterator in type
    // system but Node's fromWeb accepts the runtime object fine.
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counting) as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(path));
    return { path, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
