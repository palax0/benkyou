import { closeDbClient } from '@benkyou/core/db';
import {
  estimateRssUrlEmbeddingCost,
  type EstimatedRssItem,
  type RssEmbeddingEstimate,
} from '../packages/core/src/tools/rss-embedding-estimator';

interface CliOptions {
  url: string;
  useDb: boolean;
  sourceId?: string;
}

function printUsage(): void {
  console.error('Usage: pnpm estimate:rss <rss-url> [--db] [--source-id <uuid>]');
}

function parseArgs(argv: string[]): CliOptions {
  const [url, ...rest] = argv;
  if (!url || url.startsWith('-')) {
    printUsage();
    process.exit(1);
  }

  let useDb = false;
  let sourceId: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--db') {
      useDb = true;
    } else if (arg === '--source-id') {
      const value = rest[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--source-id requires a value');
      }
      sourceId = value;
      useDb = true;
      i++;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { url, useDb, sourceId };
}

function formatItem(item: EstimatedRssItem, index: number): string {
  return [
    `${index + 1}. ${item.totalTokens.toLocaleString()} tokens`,
    `[doc=${item.docTokens.toLocaleString()}, title=${item.titleTokens.toLocaleString()}, bodyChars=${item.bodyChars.toLocaleString()}, ${item.contentSource}]`,
    item.title,
    item.url,
  ].join(' ');
}

function printEstimate(url: string, sourceId: string | null, estimate: RssEmbeddingEstimate): void {
  console.log(`RSS: ${url}`);
  if (sourceId) console.log(`Matched source: ${sourceId}`);
  console.log(`Fetched items: ${estimate.fetchedItems.toLocaleString()}`);
  console.log(`Skipped existing: ${estimate.skippedExisting.toLocaleString()}`);
  console.log(`Estimated new items: ${estimate.estimatedItems.toLocaleString()}`);
  console.log(`Readability fetched: ${estimate.readableFetched.toLocaleString()}`);
  console.log(`Readability unavailable: ${estimate.readableFailed.toLocaleString()}`);
  console.log(`Estimated embedding input tokens: ${estimate.totalTokens.toLocaleString()}`);
  console.log(`Average per item: ${estimate.averageTokens.toLocaleString()}`);
  console.log(`Max item: ${estimate.maxTokens.toLocaleString()}`);

  if (estimate.topItems.length > 0) {
    console.log('\nTop items:');
    estimate.topItems.forEach((item, index) => console.log(formatItem(item, index)));
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const { sourceId, estimate } = await estimateRssUrlEmbeddingCost(options);
  printEstimate(options.url, sourceId, estimate);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await closeDbClient();
}
