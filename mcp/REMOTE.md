# Remote MCP and session prescriptions

The original stdio command (`node mcp/src/index.js`) remains available. Both stdio
and the opt-in HTTP API use `src/service.js` and the same tool handlers and pure
training functions. Read tools carry `readOnlyHint: true`; `set_next_session` is an
idempotent write with a strict schema, not a generic profile mutation.

Build the opt-in API from the repository root using `api/Dockerfile.mcp` or run
`docker compose -f compose.pi.yaml up -d --build` for the isolated deployment.
The ordinary `api/Dockerfile` stays independent of MCP dependencies.

Set `MCP_ENABLED=1`, `ORIGIN=https://your-hostname`, `RP_ID=your-hostname`, and
`MCP_REDIRECT_URIS` to the exact callbacks allowed for your clients. Public exposure
requires HTTPS. `/mcp` requires an OAuth bearer token on every request. OpenGym's
normal sign-in and an explicit consent page grant per-profile `training:read` and
`sessions:write` scopes. Codes expire after 120 seconds, access tokens after one
hour, refresh tokens after 30 days. Codes and refresh tokens are single-use.
Revoking either token invalidates the grant's family. Tokens are stored as hashes;
account disable/deletion invalidates access immediately. OAuth metadata advertises
PKCE S256, DCR, revocation and issuer identification. The SDK implements the
Streamable HTTP 2025-11-25-compatible stateless transport (POST, JSON or SSE).

Additional tools:
- `set_next_session`: immutable dated prescription, caller-generated stable ID.
- `list_sessions`: prescribed dates, details and planned/completed status.
- `get_session`: original prescription, completed workout, actual rows and skipped exercises.
- `get_exercise_history`: exercise-specific history including effort and notes.

Example strength prescription:

```json
{
  "session_id": "lower-2026-10-11",
  "date": "2026-10-11",
  "routine_id": "YOUR_ROUTINE_ID",
  "unit": "kg",
  "notes": "Do not progress if foot discomfort appears",
  "exercises": [{
    "position": 1,
    "exercise_id": "YOUR_EXERCISE_ID",
    "notes": "Controlled eccentric",
    "sets": [
      {"load": 50, "reps": 7, "rir": 2},
      {"load": 50, "reps": 7, "rir": 2},
      {"load": 50, "reps": 7, "rir": 2},
      {"load": 50, "reps": 7, "rir": 2}
    ]
  }]
}
```

All routine exercises must be prescribed in order. V1 explicitly rejects timed,
cardio, per-side, warm-up and intensifier configurations. No master routine edits,
completed-workout writes, or arbitrary state mutation are exposed. Only one pending
prescription per date and 20 per profile; dates are within 60 days. An identical
retry returns the same record; an attempted change to an existing ID is refused.

The calendar picks that date's routine. Starting a workout fetches current
prescriptions first; rows use the explicit loads/reps and coaching notes. Target
RIR/RPE are separate from actual RIR/RPE, so a prescription is never logged as
completed effort. Finished workouts retain `session_id` and the original snapshot.
Completing and syncing a workout makes the actual rows available to `get_session`.

Runtime files under `data/` are private and gitignored. Prescriptions are isolated
from whole-state sync in `prescriptions-<uid>.json`; writes use a cross-process lock
and durable atomic replacement. HTTP scopes apply at the transport boundary;
stdio retains the local filesystem trust boundary and can use the same scoped
prescription tool when its data directory is writable. Read-only mounts continue
to support the original read tools.
