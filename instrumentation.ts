/**
 * Starts the server's background work once per process: finishing setup
 * (deploy, top-ups, ERC-8004 registration) and the Proof Engine's loop.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.ACCRUE_DISABLE_KEEPER === "1") return;
  const { runSetup } = await import("./lib/server/bootstrap");
  const { engineTick } = await import("./lib/server/engine");

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runSetup();
      await engineTick();
    } finally {
      busy = false;
    }
  };
  setTimeout(tick, 2_000);
  setInterval(tick, Number(process.env.ACCRUE_TICK_MS ?? 6_000));
}
