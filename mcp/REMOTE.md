# Remote MCP and session prescriptions

The original stdio command (`node mcp/src/index.js`) remains available. Both stdio
and the opt-in HTTP API use `src/service.js` and the same tool handlers and pure
training functions. Read tools carry `readOnlyHint: true`; each prescription tool is an
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

## Standalone workouts and safe revisions

`get_profile` identifies the connected profile and its load unit. `search_exercises`
finds catalogue exercises and that profile's custom exercises, returning stable IDs
and supported modes. Use these IDs rather than inventing exercises or silently
substituting a partial test routine.

`create_session_prescription` accepts a complete one-off workout: `session_id`,
`title`, `date`, `unit`, optional `base_routine_id` and `notes`, and an ordered
`exercises` array. No saved routine is required. `base_routine_id` records provenance
only; the supplied exercise list defines the session and never edits the master.
Each exercise requires `position`, `exercise_id`, `mode` (`reps` or `time`), and
`sets`. A set requires `load` and either `reps` or `seconds`. Optional fields include
`phase` (`warmup` or `work`), target `rir` or `rpe`, and coaching `notes`.
Exercise options include `rest_sec` (including zero), `unilateral` (reps per side),
and `superset_group` (two or more adjacent exercises with the same group ID).
Warm-ups precede work sets. Cardio, timed unilateral sets and intensifiers are not
supported by this tool. Limits: 100 exercises, 30 sets per exercise, 300 sets total.

`replace_session_prescription` accepts `session_id`, `expected_revision`, and a
complete `prescription` payload with the same fields except `session_id`. It keeps
the stable ID, increments `revision`, and archives previous prescriptions in
`revisions`. Identical retries do not make extra versions. Conflicting revisions
fail; read `get_session` and explicitly reconcile rather than blindly overwriting.
Replacement is allowed only before a session starts, is cancelled, or is completed.
Legacy routine prescriptions on or before today cannot be upgraded safely.

The calendar and home screen display standalone sessions using transient routine
projections; they are never inserted into the saved routine library. Before a new
standalone session opens, the app claims its revision through the authenticated
`POST /api/session-prescriptions/start` endpoint. Claim and replacement share the
same lock. A first start requires connectivity; a claimed session can resume offline.
This also applies when logging a missed standalone session from history.

Completed workouts retain the exact prescription snapshot and revision.
`get_session` compares actual loads, reps, time, per-side effort, skipped or partial
sets and notes with that snapshot, and reports both actual and current revisions.
All writes use the existing per-profile `sessions:write` scope; no additional
account, routine, or generic state mutation tools are exposed.

## Session inbox, context and appraisal reads

In the app, **Plan → Sessions** lists upcoming, expired, started, completed,
abandoned and cancelled prescriptions. Today's unstarted session offers an optional
check-in before Start. Completed sessions have a planned-versus-completed comparison;
the same comparison is available from the history detail sheet.

A started prescription can be abandoned explicitly. The app retains its partial
results, their unit, check-in and reason in the server-owned prescription record.
The revision stays closed; a new dated prescription is needed to train again.
Discard waits for server acknowledgement and preserves the device workout on failure.
If the starting device is unavailable, the inbox can close the session with an
explicit note that actual rows are unavailable. Completing later on that device
still retains actual training history and the abandonment audit record.

Unstarted standalone sessions can be postponed in the inbox. This uses
`POST /api/session-prescriptions/postpone`, creates a revision and archives the old
date/sets. Stale revisions, started sessions and occupied dates are refused.
Abandonment uses `POST /api/session-prescriptions/abandon`; both endpoints use the
existing app authentication and same-origin protection. No new MCP write scope is
introduced. Abandoned sessions no longer reserve a date or unfinished-session slot.

Exercise swaps retain the original prescription position and exercise ID while
recording the actual replacement's own ID/snapshot and reason. A partially completed
unilateral exercise is treated as logged work and cannot be relabelled. Record a
replacement reason in its exercise-note sheet; generic reasons for changed or skipped
work can be saved in the session-note sheet. Entirely skipped exercise notes are
retained separately from completed progression history.

**Exercises → exercise details → Load convention & setup** (also available in
the active exercise-note sheet) stores a convention (per dumbbell, total,
added load, assistance or bodyweight), machine/gym label and familiar aliases.
Standing setup notes and these conventions are exposed by the read-only
`get_training_context`, optionally limited to `exercise_ids` (maximum 100).
`search_exercises` accepts `available_only`; results include selected-profile
availability, saved conventions, favourites and last use. Unknown conventions and
app-default increments are identified explicitly. Prescriptions snapshot this
context; current settings never rewrite the historical prescription.

`list_sessions` accepts optional `from`, `to`, `status`, `limit` (1–50, default 20)
and `offset`. Its compact results omit revision archives and per-set comparisons;
`get_session` remains the full detail read. `get_training_summary(from,to)` accepts
an ordered range of at most 366 days and returns completed work by exercise/muscle,
effort coverage, dated session comparisons, recorded context and bodyweight change.
These tools reuse the app's counting rules and are read-only on both transports.

Weekly volume targets include dated prescriptions instead of the recurring target
on those dates. Completed sessions use their opened prescription revision. Undated
queue slots remain a weekly budget; a prescription naming a queue base routine
replaces that slot once. Historical targets use preserved prescriptions only because
older recurring schedules are not archived. A unilateral pair is one work set; one
completed limb is half. Warm-ups and cardio are excluded, and missing effort is
reported as unknown. Readiness is self-reported context, not an inferred measurement.

First-start connectivity is still required. Active sets remain device-local until
Finish and successful sync; the inbox and workout screen state that boundary.
