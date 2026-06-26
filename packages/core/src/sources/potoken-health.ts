// Generic sidecar health check (spec §8). Survives the youtubei.js retirement because
// /admin/jobs still surfaces clustered YouTube degradation (the extract-cloudflare trap).
// yt-dlp's pot plugin owns token FETCH now; this is health-only.
export async function pingPotokenSidecar(providerUrl: string): Promise<boolean> {
  const base = providerUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/ping`);
    return res.ok;
  } catch {
    return false;
  }
}
