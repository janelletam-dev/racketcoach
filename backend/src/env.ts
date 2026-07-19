// Load backend/.env into process.env for local dev. tsx does not do this on
// its own. On Modal the env comes from the image + secret, so a missing file
// is expected and fine. Imported first (before any module reads process.env).
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file present (e.g. on Modal) — rely on the real environment
}
