// Next runs register() once at server startup. Validate env here so a
// misconfigured deployment fails fast at boot rather than on the first request
// that touches @benkyou/core. nodejs-runtime only: assertEnv reads process.env,
// and the edge runtime shouldn't pull in the node-only core modules.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertEnv } = await import('@benkyou/core/config');
    assertEnv();
  }
}
