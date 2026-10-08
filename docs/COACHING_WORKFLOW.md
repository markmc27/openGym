# Coaching workflow: priorities 2–7

Implemented 8 October 2026. Long-term programming and coaching decisions remain external.

| Priority | Delivered |
|---|---|
| 2. Substitutions | Actual ID/name snapshot replaces the original exercise snapshot; repeated swaps retain the original prescription position. Completed unilateral limbs are protected. Replacement reasons persist into comparison. |
| 3. Lifecycle and sync | Explicit abandonment retains partial rows, their unit, readiness and reason without unlocking a revision. Date capacity is released. An unopened standalone session can be postponed with an archived revision. Discard preserves the device workout if the server cannot acknowledge it. |
| 4. Session UI | Plan → Sessions offers status filters, paging, prescription previews, optional check-in/start, resume on the starting device, postponement and completed comparison. History detail includes the comparison too. |
| 5. Equipment/load context | Selected equipment profiles, availability, standing notes, load conventions, gym/machine labels, aliases, favourites, recent use and increment provenance are available through MCP. Exercise details let the athlete configure these before training. Prescriptions retain snapshots. |
| 6. Adherence | Dated prescriptions replace that day's recurring target. Actual completed sides count independently, at half a set per side. Warm-ups/cardio are excluded; unrated effort remains unknown. Completed comparisons use the opened revision. |
| 7. Context and review | Optional time, energy, soreness, discomfort and context fields; reasons for changed/skipped work; retained notes for completely skipped exercises. Paginated MCP inbox and bounded training summaries reuse app calculations. |

## Athlete use

1. In Exercises, open an exercise and select **Load convention & setup**. Confirm whether a load means per dumbbell, total, added load, assistance or bodyweight. Add relevant seat/pin notes and a machine label. For genuinely different machines, use distinct custom exercise IDs.
2. In **Plan → Sessions**, view an upcoming prescription. On its date, **Check-in & start** offers optional context. Nothing in the check-in is required.
3. Log actual sets and effort normally. A swap changes this session only. Use its exercise note to record the replacement reason. Use the workout's session-note action for readiness and general reasons for changes.
4. Finish, then allow sync to succeed. Active sets are stored on the starting device; ChatGPT does not receive them live.
5. View the completed comparison from Sessions or the history detail sheet. Unchecked targets are displayed as skipped rather than as performed loads/reps.

A first start requires connectivity. Resume on the device where the workout began.
Abandonment is an auditable closure, not a pause: the original prescription remains
closed and partial results remain queryable. Ask the coach to create a new dated
session when needed. If the original device is unavailable, the inbox can close the
record while explicitly noting that its actual rows are unavailable. A later finish
on that device retains actual history alongside the abandonment audit.

## Coach reads

- `get_training_context(exercise_ids?)`: selected equipment and safe exercise context, up to 100 IDs, with truncation reported.
- `search_exercises(..., available_only?)`: authoritative IDs, familiar aliases and availability.
- `list_sessions(from?, to?, status?, limit?, offset?)`: compact filtered inbox; default page 20, maximum 50.
- `get_session(session_id)`: full prescription/completion/abandonment detail, preserved revision, substitutions and actual rows.
- `get_training_summary(from, to)`: range of at most 366 days, actual sets by exercise/muscle, rated/unrated coverage, session deviations and bodyweight change.

Read tools are marked read-only on both transports. Existing narrow prescription
writes and OAuth scopes remain in use. App lifecycle writes are authenticated,
origin-protected, schema-bounded and use locked atomic prescription storage.

## Counting limits

A bilateral working set or complete unilateral pair counts as one set; a completed
limb counts as 0.5. This applies to effective muscle sets and effort coverage, not
raw row counts. Substituted exercises contribute to the muscles actually trained;
no numerical strength comparison is made between different lifts. Missing effort
is not classified as an easy or hard set.

Every completed prescription on a date counts once; that day's recurring target is
replaced once even when several completed sessions share the date.

For the current week, undated queue routines remain a weekly budget. A prescription
that names a queue base routine replaces that slot once. Historical target charts
use preserved dated prescriptions because earlier recurring schedules are not
archived. Self-reported readiness does not replace clinical assessment or measured
readiness. The tools report observations and do not automatically progress routines.

## Validation

- Frontend: 4,326 passing tests.
- API: 561 passing tests; final lifecycle integration rechecked after the schema additions.
- MCP: 112 passing tests, including discovery and new reads over authenticated HTTP.
- Production frontend build, plain-Node MCP import graph and generated API reference checks passed.

Additional coverage exercises partial-side swaps, retained substitution identity,
abandonment retries/ownership/revision bounds, postponed archives, failed discard
acknowledgement, skipped-exercise notes, dated targets, unknown effort, context merge
and account-change guards.

Backup configuration is outside this change. Conditioning/mobility extensions are
priority 8 and remain a separate contribution. See `mcp/REMOTE.md` and
`api/openapi.yaml` for transport and request contracts.
