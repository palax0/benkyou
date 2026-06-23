import { describe, expect, test, vi } from 'vitest';
import {
  withYoutubeSession,
  isYoutubeTokenExpiryError,
  YoutubeTokenExpiryError,
  singleFlight,
  type SessionDeps,
} from '../../src/sources/youtube-session.js';
import { TransientFetchError } from '../../src/sources/types.js';
import type { Innertube } from 'youtubei.js';

const FAKE_YT = {} as Innertube;
function deps(over: Partial<SessionDeps> = {}): SessionDeps {
  return {
    enabled: true,
    loadToken: vi.fn(async () => ({ poToken: 'cached', visitorData: 'VD' })),
    refreshToken: vi.fn(async () => ({ poToken: 'fresh', visitorData: 'VD' })),
    buildInnertube: vi.fn(async () => FAKE_YT),
    ...over,
  };
}

describe('isYoutubeTokenExpiryError', () => {
  test.each([
    [new Error('Request failed with status 400'), true],
    [new Error('No valid URL to decipher'), true],
    [new Error('status 403 Forbidden'), true],
    [new YoutubeTokenExpiryError({ durationSeconds: 10, title: null, cues: [] }), true],
    [new TransientFetchError('502'), false],
    [new Error('totally unrelated'), false],
  ])('%s', (err, expected) => {
    expect(isYoutubeTokenExpiryError(err)).toBe(expected);
  });
});

describe('withYoutubeSession', () => {
  test('happy path: runs op once with cached token, no refresh', async () => {
    const d = deps();
    const r = await withYoutubeSession(async () => 'ok', d);
    expect(r).toBe('ok');
    expect(d.refreshToken).not.toHaveBeenCalled();
  });

  test('no cached token → refreshes before first run', async () => {
    const d = deps({ loadToken: vi.fn(async () => null) });
    await withYoutubeSession(async () => 'ok', d);
    expect(d.refreshToken).toHaveBeenCalledTimes(1);
  });

  test('expiry on first op → refresh once → retry succeeds', async () => {
    const d = deps();
    let calls = 0;
    const r = await withYoutubeSession(async () => {
      calls += 1;
      if (calls === 1) throw new Error('status 400');
      return 'recovered';
    }, d);
    expect(r).toBe('recovered');
    expect(d.refreshToken).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });

  test('expiry twice → propagates the second error (no infinite refresh)', async () => {
    const d = deps();
    await expect(
      withYoutubeSession(async () => { throw new Error('status 400'); }, d),
    ).rejects.toThrow(/400/);
    expect(d.refreshToken).toHaveBeenCalledTimes(1);
  });

  test('TransientFetchError passes through without refresh', async () => {
    const d = deps();
    await expect(
      withYoutubeSession(async () => { throw new TransientFetchError('502'); }, d),
    ).rejects.toBeInstanceOf(TransientFetchError);
    expect(d.refreshToken).not.toHaveBeenCalled();
  });

  test('disabled: builds bare session, runs once, never refreshes', async () => {
    const d = deps({ enabled: false });
    await withYoutubeSession(async () => 'ok', d);
    expect(d.loadToken).not.toHaveBeenCalled();
    expect(d.refreshToken).not.toHaveBeenCalled();
    expect(d.buildInnertube).toHaveBeenCalledWith(null);
  });
});

describe('singleFlight', () => {
  test('concurrent callers share one in-flight invocation', async () => {
    let calls = 0;
    const resolvers: Array<(v: number) => void> = [];
    const gated = singleFlight(() => {
      calls += 1;
      return new Promise<number>((r) => resolvers.push(r));
    });
    const a = gated();
    const b = gated();
    expect(calls).toBe(1);
    resolvers[0]!(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
  });

  test('a call after settle re-invokes (no stale memo)', async () => {
    let calls = 0;
    const gated = singleFlight(async () => { calls += 1; return calls; });
    expect(await gated()).toBe(1);
    expect(await gated()).toBe(2);
  });

  test('rejection clears the in-flight slot so the next call retries', async () => {
    let calls = 0;
    const gated = singleFlight(async () => { calls += 1; throw new Error(`fail ${calls}`); });
    await expect(gated()).rejects.toThrow('fail 1');
    await expect(gated()).rejects.toThrow('fail 2');
  });
});
