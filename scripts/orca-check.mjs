// Read-only local readiness check: never calls Jev or sends screen contents.
import { createOrcaDriver } from "./orca-driver.mjs";
import { parseAX, selectCandidates } from "./loop.mjs";
import { loadApiKey } from "./jev-decide.mjs";

const app = process.argv[2];
const options = process.argv.slice(3);
if (!app || app.startsWith("--") || options.some(option => option !== "--restore-window")) {
  console.error("Usage: npm run orca:check -- <app-name-or-bundle-id> [--restore-window]");
  process.exitCode = 1;
} else {
  try {
    let keyConfigured = false;
    try { keyConfigured = Boolean(loadApiKey()); } catch {}
    const driver = createOrcaDriver({ restoreWindow: options.includes("--restore-window") });
    await driver.bind(app);
    const ax = await driver.observe();
    const elements = parseAX(ax);
    const candidates = selectCandidates(elements);
    console.log(JSON.stringify({ app, keyConfigured, keyAuthenticated: false,
      elements: elements.length, candidates: candidates.length, jevRequests: 0,
      status: candidates.length >= 2 ? "ready" : "insufficient_candidates" }, null, 2));
    if (candidates.length < 2) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
