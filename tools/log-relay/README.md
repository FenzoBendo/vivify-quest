# Vivify log relay

**Send Logs** in Vivify's settings uploads what Vivify logged since the last
upload. It only does this when the game starts with both Send Logs and Debug
Logging on. Uploads go to this relay, which commits them to the repository's
`LOGS` branch, under `logs/<date>/<time>_<version>_<upload id>/`.

The GitHub token stays in the relay. The mod only knows the relay's address, so
pulling it out of the QMOD gives nobody write access to the repository.

The relay only takes Vivify's own log files, at most 12 files and 4.5 MB of
text per upload. `LOGS` is created on the first upload as a branch of its own,
with no history shared with `main`.

## Set up (once)

1. **Make a token.** On GitHub, open Settings → Developer settings →
   Fine-grained tokens, and generate one with:
   - Repository access: only `trail-b1az3r/vivify-quest`
   - Permissions: Contents **Read and write**, nothing else

   GitHub cannot limit a token to a single branch, so protect `main`
   (Settings → Branches → add a rule for `main`). The token can then only
   reach the other branches.
2. **Deploy the relay** with a free Cloudflare account and Node:
   ```
   cd tools/log-relay
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN     # paste the token
   npx wrangler deploy
   ```
   `deploy` prints the address, for example
   `https://vivify-log-relay.<you>.workers.dev`.
3. **Give the builds the address.** In the repository, open Settings →
   Secrets and variables → Actions → **Variables**, and add
   `VIVIFY_LOG_RELAY_URL` with that address. Builds from then on send to it.
   A build without it sends nothing and says so in its log. A player can also
   set `"logRelayUrl"` in Vivify's config file.

## Test

`node test.mjs` runs the relay against a fake GitHub API. It checks:
- the first upload creates the branch, and later uploads stack on it;
- an upload retries when two land at once;
- bad names, sizes and fields are refused.
