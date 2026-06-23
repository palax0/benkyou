import { getTranslations } from 'next-intl/server';
import { getPipelineStatus, STATES, type StageTokens } from '@benkyou/core/pipeline';
import { AutoRefresh } from '@/components/AutoRefresh';
import { RetryButton } from './RetryButton';

type JobsTranslator = Awaited<ReturnType<typeof getTranslations<'jobs'>>>;

const STALL_MS = 30 * 60 * 1000;

function stalled(updatedAt: Date | null): boolean {
  return updatedAt != null && Date.now() - new Date(updatedAt).getTime() > STALL_MS;
}

export default async function JobsPage() {
  const t = await getTranslations('jobs');
  const s = await getPipelineStatus();
  const stateMap = Object.fromEntries(s.stateCounts.map((c) => [c.state, c.count]));

  return (
    <main className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <AutoRefresh />
      </div>

      {/* 1. State distribution */}
      <section>
        <h2 className="mb-2 font-semibold">{t('stateDistribution')}</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          {STATES.map((st) => (
            <a
              key={st}
              href={st === 'failed' ? '#failed' : '#inflight'}
              className="rounded border border-slate-200 px-2 py-1 dark:border-slate-700"
            >
              {t(`state.${st}` as 'state.done')}: <strong>{stateMap[st] ?? 0}</strong>
            </a>
          ))}
        </div>
      </section>

      {/* 2. Queue health + orphans */}
      <section>
        <h2 className="mb-2 font-semibold">{t('queueHealth')}</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-slate-500">
              <th>{t('stage')}</th>
              <th>created</th>
              <th>retry</th>
              <th>active</th>
            </tr>
          </thead>
          <tbody>
            {s.queueHealth.map((q) => (
              <tr key={q.stage}>
                <td>{q.stage}</td>
                <td>{q.created}</td>
                <td>{q.retry}</td>
                <td>{q.active}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.orphans.length > 0 ? (
          <div className="mt-2">
            <p className="text-sm font-semibold text-red-600">{t('orphansTitle')}</p>
            <ul className="flex flex-col gap-1 text-sm">
              {s.orphans.map((o) => (
                <li key={o.id} className="flex items-center gap-2">
                  <span className="text-red-600">{t('taskLost')}</span>
                  <span className="truncate">{o.title}</span>
                  <span className="text-slate-500">{o.currentStage}</span>
                  <RetryButton itemId={o.id} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* 3. In-flight */}
      <section id="inflight">
        <h2 className="mb-2 font-semibold">{t('inFlight')}</h2>
        {s.inFlight.length === 0 ? (
          <p className="text-slate-500">{t('none')}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {s.inFlight.map((i) => (
              <li
                key={i.id}
                className={`flex items-center gap-2 ${stalled(i.updatedAt) ? 'text-amber-600' : ''}`}
              >
                <span className="truncate">{i.title}</span>
                <span className="text-slate-500">{i.sourceName}</span>
                <span>{i.currentStage}</span>
                <span className="text-slate-500">{t('attempts', { n: i.attempts })}</span>
                {stalled(i.updatedAt) ? <span>{t('stalled')}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. Failed */}
      <section id="failed">
        <h2 className="mb-2 font-semibold">{t('failed')}</h2>
        {s.failed.length === 0 ? (
          <p className="text-slate-500">{t('none')}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {s.failed.map((f) => (
              <li key={f.id} className="flex flex-col gap-1 rounded border border-slate-200 p-2 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{f.title}</span>
                  <span className="text-slate-500">{f.sourceName}</span>
                  <span>{f.currentStage}</span>
                  <span className="text-slate-500">{t('attempts', { n: f.attempts })}</span>
                  <RetryButton itemId={f.id} />
                </div>
                {f.lastError ? (
                  <details>
                    <summary className="text-red-600">{t('lastError')}</summary>
                    <pre className="whitespace-pre-wrap text-xs">{f.lastError}</pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 5. Token consumption */}
      <section>
        <h2 className="mb-2 font-semibold">{t('tokens')}</h2>
        <p className="text-sm text-slate-500">{t('today')}</p>
        <TokenTable rows={s.tokens.today} t={t} />
        <p className="mt-2 text-sm text-slate-500">{t('week')}</p>
        <TokenTable rows={s.tokens.week} t={t} />
        <p className="mt-2 text-sm text-slate-500">{t('topItems')}</p>
        <ul className="text-sm">
          {s.tokens.topItems.map((it) => (
            <li key={it.id ?? 'none'}>
              {it.title ?? t('untitled')}: {it.totalTokens}
            </li>
          ))}
          <li className="text-slate-500">{t('noItemTokens', { n: s.tokens.noItem })}</li>
        </ul>
      </section>

      {/* 6. Dimension drift */}
      <section>
        <h2 className="mb-2 font-semibold">{t('drift')}</h2>
        {s.drift.consistent ? (
          <p className="text-sm text-green-600">{t('driftOk', { dim: s.drift.envDim })}</p>
        ) : (
          <p className="text-sm text-red-600">
            {t('driftWarn', { env: s.drift.envDim, col: s.drift.columnDim ?? 0, set: s.drift.settingsDim ?? 0 })}
          </p>
        )}
      </section>

      {/* 7. Transcription cost (audio minutes only — no money; spec §5.3) */}
      <section>
        <h2 className="mb-2 font-semibold">{t('transcriptionMinutes')}</h2>
        <p className="text-sm">{s.transcriptionMinutes}</p>
      </section>

      {/* 8. PoToken sidecar health (clustered YouTube degradation; design §5) */}
      <section>
        <h2 className="mb-2 font-semibold">{t('potokenHealth')}</h2>
        {!s.potoken.configured ? (
          <p className="text-sm text-slate-500">{t('potokenOff')}</p>
        ) : s.potoken.reachable ? (
          <p className="text-sm text-green-600">{t('potokenUp')}</p>
        ) : (
          <p className="text-sm text-red-600">{t('potokenDown')}</p>
        )}
      </section>
    </main>
  );
}

function TokenTable({
  rows,
  t,
}: {
  rows: StageTokens[];
  t: JobsTranslator;
}) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">{t('none')}</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-slate-500">
          <th>{t('stage')}</th>
          <th>{t('calls')}</th>
          <th>in</th>
          <th>out</th>
          <th>total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.stage}>
            <td>{r.stage}</td>
            <td>{r.calls}</td>
            <td>{r.inputTokens}</td>
            <td>{r.outputTokens}</td>
            <td>{r.totalTokens}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
