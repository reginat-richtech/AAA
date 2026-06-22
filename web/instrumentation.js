// Next.js startup hook. Boots the Social Media auto-publish scheduler, but ONLY
// in the Node.js server runtime. The `=== 'nodejs'` guard around the dynamic
// import is what keeps the node-only scheduler (pg, crypto, sharp) out of the
// edge bundle — without it, `next build` fails with module-not-found.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startSocialScheduler } = await import('./lib/social/scheduler');
    startSocialScheduler();
  }
}
