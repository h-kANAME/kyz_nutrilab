/**
 * Job CLI para Mission Control (docker exec).
 *
 * Uso:
 *   node dist/jobs/runNotifications.js
 *   node dist/jobs/runNotifications.js --dry-run
 *
 * Panel (UTC, tick cada 15 min):
 *   exec service=nutrilabapi match=nutrilab -- node dist/jobs/runNotifications.js
 *   schedule: every 15 minutes (cron star-slash-15)
 */
import { loadEnv } from '../config/env.js';
import { openDb, migrate } from '../db/index.js';
import { runNotificationReminders, arClock } from '../services/notificationJob.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const env = loadEnv();
  const db = openDb(env.SQLITE_PATH);
  migrate(db);

  const clock = arClock();
  console.log(
    JSON.stringify({
      event: 'start',
      dryRun,
      ar: clock,
      sqlite: env.SQLITE_PATH,
    }),
  );

  try {
    const result = await runNotificationReminders(db, env, { dryRun });
    console.log(JSON.stringify({ event: 'done', ...result }));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ event: 'error', message: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  }
}

void main();
