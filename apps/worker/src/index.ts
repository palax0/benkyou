import { env } from '@benkyou/core/config';

async function main() {
  if (env.DEPLOY_MODE === 'docker') {
    const { runLoop } = await import('./loop.js');
    await runLoop();
  } else if (env.DEPLOY_MODE === 'serverless') {
    console.log(
      'Worker entry started in serverless mode — exiting immediately. Use /api/cron/work to trigger work.',
    );
    process.exit(0);
  } else {
    console.error(`Unknown DEPLOY_MODE: ${env.DEPLOY_MODE as string}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Worker fatal:', err);
  process.exit(1);
});
