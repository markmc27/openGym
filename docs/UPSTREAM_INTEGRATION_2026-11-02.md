# Upstream 1.4.3 integration — 2 November 2026

Pinned upstream: `b6cfe2bbd3f099523ffbf2677438864e9a09a06f`.
Baseline: `2b19acc57965cb4df9c2710d0735c2667f8650d2`.
Branch: `codex/upstream-1.4.3-integration`. Production is not deployed.

## Decisions

- Preserve the shared stdio/Streamable HTTP service, 20 annotated tools, OAuth/PKCE, existing scopes, per-profile isolation and narrow prescription writes.
- Defer registration of upstream `log_workout` on both transports. Its implementation/tests remain in the tree for evaluation, but existing prescription grants do not gain authority to write completed history.
- Carry across the independently authorised ChatGPT and local n8n OAuth callback allowlist; the original working copy's uncommitted change is preserved.
- Adopt upstream same-origin API handling, strict browser login JSON/origin checks, pairing ownership proof, token-purpose separation, owner permissions, recovery, push/queue hardening and CSP. Account removal now revokes MCP and prescription data through the shared removal helper for both self-service and admin deletion.
- Pin our custom MCP API image to Node 22.23.4 and apply Alpine package updates; preserve UID 1000, dropped capabilities and no-new-privileges. The web uses upstream's nginx-unprivileged 1.30.6 image (UID 101).
- Use Zod 4 consistently in the fork's shared tool schemas and reconcile both Express/MCP dependencies. Apply additional compatible dependency advisory fixes published since the upstream lockfiles. API, MCP and frontend production audits report zero known advisories; these are advisory checks, not a proof of absence of vulnerabilities.
- Keep `exerciseContexts` in server/client stamped-map registries alongside the new machine-stack and photo fields. Preserve prescribed sessions, opened revisions, lifecycle, readiness, actual identity and work-set adherence.
- All manual and planned-backup swaps pass through the same commit helper. Preserve exercise snapshots and confirmation for a completed unilateral limb, as well as the original prescription position.
- Combine upstream's native session-start options with our prescription/readiness arguments. Coach targets are applied after the ordinary session builder and remain authoritative.
- Preserve explicit zero-second prescribed rest alongside upstream's No timer/per-set rest controls.
- Expose irregular machine stacks in MCP context in profile units. When `weight_stack` is present, coaches should use its listed weights instead of the nominal default increment. Explicit prescriptions are never silently snapped to another load.
- Unify native aliases and coaching aliases: explicit native aliases (including a deliberate clear) take precedence; existing coaching aliases remain readable when no native setting exists. Saving coaching setup updates the canonical native map. Old snapshots remain immutable.
- Preserve strict work-set adherence counts excluding warm-ups, independent of the display preference to include warm-ups in total lifted volume.

## Verification

All suites ran with **Node 22.23.4**, matching the API runtime and upstream CI's major version:

- Frontend: **6,577 tests passed**, 548 files.
- API: **697 tests passed**.
- MCP: **150 tests passed**, eight files.
- Total: **7,424 passing tests**.
- Production build, plain-Node imports (including service/server/HTTP modules), generated API reference and conflict/whitespace checks passed.
- The two icon byte-regeneration checks fail under the Mac's Node 24 zlib output but pass unchanged under Node 22. No image assets or tests were weakened to accommodate compression differences.
- Workflow YAML parses, and the fork's non-root authenticated MCP image check remains part of CI.
- New regressions cover canonical aliases/profile isolation, irregular stack units and sync, and absence of `log_workout` from remote discovery.

## Isolated Pi stack

- Source: `/home/mark/opengym-upstream-test-20261102`.
- Compose project: `opengym-upstream-test-143`.
- Images: `opengym-api:upstream-test-20261102`, `opengym-web:upstream-test-20261102`.
- Web: Pi localhost only, `127.0.0.1:8092`.
- Data: fresh RAM-backed `/test-data` tmpfs; no live database, credentials or backups are mounted/copied.
- Startup: `docker compose -f compose.integration.yaml up -d --no-build` in that test directory.
- Result: `docker compose -f compose.integration.yaml exec -T api cat /tmp/integration-result.json`.

The guarded synthetic smoke test checks the real nginx/API/OAuth/MCP path, CSP, bundled media, signup restrictions, 20-tool discovery, aliases/stack/load context and prescribe/start/changed-load/skip/finish/sync/appraisal while preserving the master routine.

Pi ARM64 builds and runtime smoke passed at **2026-11-02 11:41:20 UTC**. Both test containers are healthy, API UID 1000:1000 and web UID 101. The smoke also verified legacy admin-to-owner migration and recovery invalidating both app sessions and OAuth grants, using only the synthetic profile. Live API/web IDs and start times were rechecked unchanged after testing.

The Pi kernel does not support Docker memory limits. CSV regression tests cover training-record portability; use JSON backups for full coaching metadata and prescription identities. The task checklist at `docs/opengym-1.4.3-integration-tasks.md` in the Pi-project repository is the progress record.

## Release boundary

Live version 1.4.1, existing accounts/grants/integrations, tunnel and routing remain unchanged during this work. Production rollout requires the user's separate go-ahead after reviewing results. No native app/watch build is claimed by these checks.
