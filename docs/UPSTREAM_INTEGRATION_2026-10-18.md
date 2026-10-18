# Upstream 1.4.1 integration — 18 October 2026

Upstream `e348fc17c42c7e9a211c5972e573ad3698190ee2` is merged into the remote-MCP coaching fork. This includes releases 1.4.0/1.4.1 and later contribution-workflow changes. Production is deliberately not deployed.

## Integration decisions

- Preserve Streamable HTTP, OAuth, strict per-profile access and all 20 shared tools. Upstream remains read-only stdio; its custom-exercise preview fix is combined with applying the dated prescription after the ordinary session builder.
- Preserve prescriptions, opened revisions, abandonment/postponement, session inbox, actual/substitution identity, readiness and adherence calculations.
- Include `exerciseContexts` in both the server and client stamped-map registries alongside upstream dumbbell settings, day notes and measurements.
- Upstream explicit dumbbell settings take precedence in MCP context. Saving coaching load setup also updates the app default. A prescription stamps its original meaning on the session target, so a later preference cannot reinterpret it. Old logged rows are not rewritten.
- Use upstream equipment availability checks, including bench/pull-up-bar requirements and compatibility defaults for older equipment profiles.
- Explicit failure markers count as known effort in the coaching summary, as they do in upstream's effort calculations. Unmarked/unrated sets remain unknown.
- Remove the old media service and media mounts from `compose.pi.yaml`: upstream now bundles its licensed media in the web image. Existing production media files are not removed.
- Resolve dependency lockfiles against the merged package manifests. Retain the fork's explicit Express/MCP dependencies.
- Repair a duplicated test import and make API review fixtures use a recent past date rather than July 2026. Otherwise these tests silently age out of the twelve-week review window. No product review limits are relaxed.

## Isolated Pi test stack

Source: `/home/mark/opengym-upstream-test-20261018`.

```
docker compose -f compose.integration.yaml up -d --no-build
```

Project `opengym-upstream-test` creates only `opengym-upstream-test-api-1` and `opengym-upstream-test-web-1`. Images are `opengym-api:upstream-test-20261018` and `opengym-web:upstream-test-20261018`; production's image tags are never overwritten.

The web binds only `127.0.0.1:8091` on the Pi. No tunnel route, public hostname or LAN binding is added. Access from the Mac, if needed, uses SSH forwarding to that private port. The API is UID 1000 and nginx UID 101.

`/test-data` is an isolated, RAM-backed tmpfs. No production data, credentials, account database or backups are copied or mounted. The guarded test startup creates one synthetic account with an in-memory random password, then exercises the actual nginx/API/MCP endpoints. It never prints the password or OAuth tokens. Restarting the test API discards the fixture and runs it again.

Read the safe result (contains check names and outcome only):

```
docker compose -f compose.integration.yaml exec -T api cat /tmp/integration-result.json
```

The smoke test covers bundled media, login, closed signup, anonymous MCP rejection, OAuth PKCE/consent, 20 tool annotations, context, prescription creation, start, changed load/reps, skipped work, completion sync and MCP appraisal. It checks the master routine remains unchanged.

Production resources `/home/mark/opengym`, `opengym-api-1`, `opengym-web-1`, `opengym-tunnel-1`, their data and Cloudflare routing are outside this test deployment. Compare their IDs and start times before/after to confirm they were not recreated or restarted.
