import { getBoss } from './boss';
import { PER_ITEM_STAGES } from '../pipeline';
import {
  DEAD_LETTER_QUEUE,
  INGEST_QUEUE,
  TRANSCRIBE_DEAD_LETTER,
  TRANSCRIBE_QUEUE,
  checkDueSources,
  registerQueues,
  type IngestJob,
  type StageJob,
  type TranscribeJob,
} from './queues';
import { handleDeadLetter, handleTranscribeDeadLetter, runIngest, runItemStage, runTranscribe } from './runner';

const DUE_SOURCE_POLL_MS = 60_000;

// Long-running worker (DEPLOY_MODE=docker). Registers a worker per queue and
// polls for due sources. Resolves only on SIGTERM/SIGINT.
export async function runWorkerLoop(): Promise<void> {
  const boss = await getBoss();
  await registerQueues(boss);

  await boss.work<IngestJob>(INGEST_QUEUE, async ([job]) => {
    if (job) await runIngest(boss, job.data);
  });
  for (const stage of PER_ITEM_STAGES) {
    await boss.work<StageJob>(stage, async ([job]) => {
      if (job) await runItemStage(boss, job.data);
    });
  }
  await boss.work<StageJob>(DEAD_LETTER_QUEUE, async ([job]) => {
    if (job) await handleDeadLetter(job.data);
  });
  await boss.work<TranscribeJob>(TRANSCRIBE_QUEUE, async ([job]) => {
    if (job) await runTranscribe(boss, job.data);
  });
  await boss.work<TranscribeJob>(TRANSCRIBE_DEAD_LETTER, async ([job]) => {
    if (job) await handleTranscribeDeadLetter(boss, job.data);
  });

  await checkDueSources(boss);
  const timer = setInterval(() => void checkDueSources(boss), DUE_SOURCE_POLL_MS);
  console.log('[worker] pipeline started: queues registered, due-source poller active');

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      clearInterval(timer);
      resolve();
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  });
}
