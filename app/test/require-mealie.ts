// Without Mealie (and a database for the push tests) every integration test
// would be skipped and the run still green.
if (!process.env.MEALIE_TEST_URL || !process.env.DATABASE_TEST_URL) {
  throw new Error("Set MEALIE_TEST_URL and DATABASE_TEST_URL.");
}
