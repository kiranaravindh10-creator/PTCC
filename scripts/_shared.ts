import { databaseOptionsFromEnv, openDatabase, type DatabaseHandle } from "@/server/db/client";

/** Loads .env.local then .env (Next.js does this for the app; scripts must do it themselves). */
export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // File not present — fine.
    }
  }
}

/** Opens the configured database, runs `fn`, and always closes it. */
export async function withDatabase<T>(fn: (handle: DatabaseHandle) => Promise<T>): Promise<T> {
  loadEnv();
  const handle = openDatabase(databaseOptionsFromEnv());
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

/** Runs a script's main function with readable error output and a proper exit code. */
export function run(main: () => Promise<void>): void {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
      if (process.env.DEBUG && error instanceof Error) console.error(error.stack);
      process.exit(1);
    },
  );
}

export function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}
