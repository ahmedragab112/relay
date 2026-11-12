import { skill, type SkillSeed } from './types.js';

export const frontendSkills: SkillSeed[] = [
  skill('react', 'React', 'Frontend', 'Build React UI that stays predictable', `Derive UI from state and keep effects for real side effects only.

- Keep components small and pass data down through explicit props.
- Use keys that identify the item, never the array index.
- Put server data in a query layer and local UI state in the component that owns it.
- Clean up subscriptions and timers in effects.
- Measure renders before memoizing anything.`),
  skill('vue', 'Vue', 'Frontend', 'Idiomatic Vue composition', `Prefer the composition API with explicit inputs and outputs.

- Keep props typed and avoid mutating them.
- Use computed values for derived state instead of watchers.
- Emit events upward; do not reach into parent state.
- Scope styles to the component.
- Clean up watchers and listeners on unmount.`),
  skill('svelte', 'Svelte', 'Frontend', 'Compact, reactive Svelte', `Let reactivity do the work and keep stores coarse.

- Derive values with reactive statements instead of duplicating state.
- Keep stores small and expose actions rather than raw setters.
- Use actions and transitions for DOM behavior.
- Avoid spreading unknown props onto DOM nodes.
- Unsubscribe from stores in onDestroy when subscribing manually.`),
  skill('next-js', 'Next.js', 'Frontend', 'Server-first Next.js apps', `Decide per route whether it renders on the server, statically, or on the client.

- Keep secrets and data access in server code only.
- Use server components by default and client components only for interactivity.
- Cache deliberately and name revalidation rules.
- Handle loading and error states per route.
- Keep API routes thin and validate their input.`),
  skill('css-architecture', 'CSS architecture', 'Frontend', 'Layered, predictable styles', `Name styles by role, not by page or color.

- Define tokens for color, spacing, radius, and type; use them everywhere.
- Keep specificity flat; avoid nested selectors that mirror the DOM.
- Scope layout to the parent and let components size themselves.
- Avoid !important except for user-preference overrides.
- Delete unused selectors instead of keeping them for later.`),
  skill('accessibility', 'Accessibility', 'Frontend', 'Interfaces that work for everyone', `Use native elements first; they carry behavior you would otherwise rebuild.

- Every control is reachable and operable by keyboard.
- Provide visible focus states and a logical focus order.
- Label inputs and give images meaningful alt text.
- Maintain 4.5:1 contrast for body text.
- Announce async changes with a live region.`),
  skill('design-systems', 'Design systems', 'Frontend', 'Tokens and components that stay consistent', `Build once, name consistently, and document the contract.

- Start from tokens rather than per-screen values.
- Give components a small, explicit set of variants.
- Keep component APIs stable; add variants instead of one-off overrides.
- Document behavior and states, not merely appearance.
- Deprecate with a migration path instead of deleting silently.`),
  skill('state-management', 'State management', 'Frontend', 'Choose the smallest state model that works', `Separate server state, URL state, and local UI state.

- Keep state close to where it is used.
- Normalize collections by id when several views share them.
- Derive what you can; store only the source of truth.
- Avoid global state for values one view owns.
- Make updates immutable and traceable.`),
  skill('forms', 'Forms', 'Frontend', 'Forms that fail clearly', `Treat validation as part of the interface.

- Validate on the server as well as the client.
- Show errors next to the field and in a summary for screen readers.
- Preserve input on failure; never clear the form.
- Disable submit only while a request is actually running.
- Confirm success in the same vocabulary as the action.`),
  skill('ui-motion', 'UI motion', 'Frontend', 'Motion that explains change', `Animate state changes, not decoration.

- Use short durations: roughly 120 to 260 ms for most UI changes.
- Prefer transform and opacity over layout properties.
- Animate entrance, dismissal, and reordering; let the rest stay still.
- Respect prefers-reduced-motion.
- Cancel or settle animations when a newer state arrives.`),

  skill('rest-apis', 'REST APIs', 'Backend & data', 'Predictable HTTP APIs', `Design resources and status codes callers can rely on.

- Use nouns for resources and HTTP verbs for actions.
- Return 400 for bad input, 401 for missing auth, 403 for denied, 404 for missing, 409 for conflict.
- Paginate collections and document the cursor.
- Make writes idempotent where clients might retry.
- Version breaking changes.`),
  skill('graphql', 'GraphQL', 'Backend & data', 'Schemas and resolvers that scale', `Design the schema around client use cases, not the database tables.

- Keep nullability honest.
- Batch and cache data loading per request to avoid N+1 queries.
- Limit query depth and cost.
- Resolve permissions at the field boundary.
- Deprecate fields before removing them.`),
  skill('postgresql', 'PostgreSQL', 'Backend & data', 'Correct schemas and queries', `Let the database enforce what must always be true.

- Use constraints for uniqueness, foreign keys, and nullability.
- Index the columns used in filters and joins; verify with EXPLAIN.
- Keep transactions short and ordered consistently.
- Use timestamptz and store UTC.
- Test queries against realistic data volume.`),
  skill('mongodb', 'MongoDB', 'Backend & data', 'Documents that fit how you read', `Model documents around access patterns.

- Embed data read together; reference data that changes independently.
- Keep documents small and bounded.
- Create compound indexes that match query order.
- Avoid unbounded arrays.
- Use schema validation at the collection level.`),
  skill('redis', 'Redis', 'Backend & data', 'Caching and fast state with Redis', `Decide up front what happens when the key is missing.

- Set TTLs on every cache entry.
- Namespace keys and version them when formats change.
- Prefer atomic operations over read-then-write.
- Treat Redis as ephemeral unless persistence is configured and tested.
- Watch memory and eviction policy in production.`),
  skill('authentication', 'Authentication', 'Backend & data', 'Sessions and tokens done safely', `Never roll your own cryptography.

- Hash passwords with a modern KDF and per-user salt.
- Store session tokens hashed and expire them server-side.
- Prefer short-lived access tokens with refresh rotation.
- Set cookies HttpOnly, Secure, and SameSite.
- Rate-limit login and reset endpoints.`),
  skill('job-queues', 'Job queues', 'Backend & data', 'Background work that survives failure', `Assume every job will fail once and run twice.

- Make handlers idempotent.
- Set timeouts and bounded retries with backoff.
- Move permanently failed jobs to a dead-letter queue.
- Keep jobs small; split long workflows into steps.
- Log job id, attempt, and outcome.`),
  skill('caching', 'Caching', 'Backend & data', 'Cache with an invalidation story', `Every cache entry needs an owner and an expiry.

- Cache the expensive, read-heavy, and tolerant-of-staleness data.
- Key by everything that changes the result.
- Invalidate on write or use short TTLs.
- Protect the origin from a cold-start stampede.
- Measure hit rate; remove caches that do not help.`),
  skill('database-migrations', 'Database migrations', 'Backend & data', 'Migrations that are safe to deploy', `Design migrations to run while old and new code are both live.

- Make each migration backward compatible.
- Add nullable columns first, backfill, then enforce.
- Rename in steps: add, dual-write, migrate, remove.
- Keep migrations small and reversible where possible.
- Test against a copy of production data.`),
  skill('observability', 'Observability', 'Backend & data', 'See what the system is doing', `Instrument the paths users care about.

- Emit structured logs with request and trace ids.
- Track latency, error rate, and saturation for each service.
- Trace cross-service calls and record the slow span.
- Alert on symptoms users feel, not on every internal metric.
- Keep dashboards short enough to read at 3 a.m.`),
];
