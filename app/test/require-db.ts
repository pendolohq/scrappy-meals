// Without a database every db test would be skipped and the run still green.
if (!process.env.DATABASE_TEST_URL) {
  throw new Error("Set DATABASE_TEST_URL to a throwaway Postgres database.");
}
