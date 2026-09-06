import app from "./app";
import { logger } from "./lib/logger";
import { runSallyMigrations } from "./lib/sally-migrate.js";
import { runPatientTestimonialsMigrations } from "./lib/patient-testimonials-migrate.js";
import { initSallyCron } from "./lib/sally-cron.js";
import { sweepExpenseOrphans } from "./lib/expense-orphan-sweep.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Run DB migrations before accepting traffic.  We await the migration so that
// the unique partial index and any data-cleanup steps are committed before the
// first HTTP request can reach the server.  A migration failure is fatal —
// the guard would be absent, so we exit rather than serve broken state.
try {
  await runSallyMigrations();
  await runPatientTestimonialsMigrations();
} catch (err) {
  logger.error({ err }, "DB migrations failed — refusing to start");
  process.exit(1);
}

// Start background jobs after migrations succeed.
// The expense-orphan sweep also runs immediately on startup so files uploaded
// before a crash are cleaned up as soon as the server comes back up.
initSallyCron();
sweepExpenseOrphans().catch((err) =>
  logger.error({ err }, "Startup expense-orphan sweep failed"),
);

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
