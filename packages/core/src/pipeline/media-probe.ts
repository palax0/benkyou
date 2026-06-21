import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

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

// ffprobe reads only headers / the moov atom (a few hundred KB) over the network.
// Returns null when the URL resolves but is not parseable media (→ caller degrades to
// unavailable). Throws on a transient failure (→ caller's extract retry consumes attempts).
export function probeRemoteDurationSec(mediaUrl: string): Promise<number | null> {
  assertHttpUrl(mediaUrl);
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
// Scheme allowlist + redirect cap. Caller MUST call cleanup() in finally.
export async function downloadToTmp(mediaUrl: string, maxBytes = TRANSCRIBE_MAX_BYTES): Promise<{ path: string; cleanup: () => Promise<void> }> {
  assertHttpUrl(mediaUrl);
  const res = await fetch(mediaUrl, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Media download failed: ${res.status} ${res.statusText}`);
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
