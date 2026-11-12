import { skill, type SkillSeed } from './types.js';

export const engineeringSkills: SkillSeed[] = [
  skill('code-review', 'Code review', 'Engineering', 'Review a change for correctness, security, and missing tests', `Read the diff first, then the surrounding code before judging anything.

- Report correctness and security problems before style.
- Verify a suspected bug is reachable in the current code before reporting it.
- Name the file, function, and failure mode for every finding, with a concrete fix.
- Call out missing tests and behavior changes that are easy to regress.
- Say plainly when nothing blocking was found; do not pad the review.`),
  skill('systematic-debugging', 'Systematic debugging', 'Engineering', 'Find the root cause before changing code', `Treat every bug as a question about where reality diverges from expectation.

- Reproduce the failure first and write down the exact steps.
- Read the full error and stack trace before forming a theory.
- Trace the bad value back to its origin; fix at the source, not the symptom.
- Change one variable at a time and state the hypothesis you are testing.
- If three fixes fail, stop and question the design instead of adding a fourth.`),
  skill('test-driven-development', 'Test-driven development', 'Engineering', 'Write the failing test before the implementation', `Work in short red, green, refactor cycles.

- Write one failing test that names the behavior that should change.
- Run it and confirm it fails for the right reason.
- Implement the smallest change that passes, then run the whole suite.
- Refactor only while everything stays green.
- Never keep implementation code written before its test; delete it and start again.`),
  skill('refactoring', 'Refactoring', 'Engineering', 'Improve structure without changing behavior', `Refactor only under a green test suite, and keep behavior fixed while you work.

- Make one mechanical change at a time and rerun tests between changes.
- Prefer extracting a well-named function over adding a comment.
- Remove dead code, duplicated branches, and unused parameters as you go.
- Keep public interfaces stable unless the change explicitly targets them.
- Stop when the structure is clear; do not redesign for hypothetical futures.`),
  skill('api-design', 'API design', 'Engineering', 'Design interfaces that are hard to misuse', `Design from the caller's side of the boundary.

- Choose names that say what the caller controls, not how the system works.
- Make invalid states unrepresentable instead of documenting them away.
- Keep one obvious way to do each thing; avoid parallel variants.
- Return errors the caller can act on, with stable codes and plain messages.
- Version or evolve without breaking existing callers.`),
  skill('error-handling', 'Error handling', 'Engineering', 'Handle failures at the boundary, not everywhere', `Handle errors where you can actually do something about them.

- Validate input at system boundaries: user input, network data, files.
- Let internal errors propagate to a single handler instead of catching and swallowing.
- Preserve the original error message and cause when wrapping.
- Never log a secret, token, or full request body.
- Make failure visible to the user in plain language with a next step.`),
  skill('logging', 'Logging', 'Engineering', 'Log enough to reconstruct what happened', `Log events that explain a decision or a failure, not every line executed.

- Include a stable identifier: request, session, task, or file.
- Use levels consistently: error for broken behavior, warn for degraded, info for lifecycle.
- Log structured fields instead of string-concatenating values.
- Never log credentials, personal data, or full payloads.
- Remove temporary debug logs before finishing.`),
  skill('performance-tuning', 'Performance tuning', 'Engineering', 'Measure before optimizing anything', `Find the real bottleneck before changing code.

- Reproduce the slow path and capture a baseline number.
- Measure with a profiler or timing around the suspected section.
- Fix the dominant cost first; do not micro-optimize cold paths.
- Re-measure after each change and keep the numbers.
- Prefer fewer round trips and smaller payloads over clever code.`),
  skill('concurrency', 'Concurrency', 'Engineering', 'Share state safely and predictably', `Name the shared state and who can mutate it before writing concurrent code.

- Prefer message passing or immutable snapshots over shared mutable state.
- Put every async operation behind a defined cancellation and timeout path.
- Guard read-modify-write sequences with the narrowest lock that works.
- Make retries idempotent and cap them.
- Test the interleavings that matter: double submit, cancellation, and slow consumers.`),
  skill('dependency-upgrades', 'Dependency upgrades', 'Engineering', 'Upgrade dependencies without breaking the app', `Read release notes and the migration guide, not only the version number.

- Upgrade one dependency family at a time and keep the lockfile change isolated.
- Run type checking and the full test suite after each upgrade.
- Search the code for removed or renamed APIs before bumping.
- Prefer the smallest version jump that fixes the reason for upgrading.
- Record why a dependency is pinned when it must stay behind.`),

  skill('typescript', 'TypeScript', 'Languages', 'Write types that carry meaning', `Model the domain, not the implementation.

- Prefer discriminated unions for states that are mutually exclusive.
- Avoid any; use unknown and narrow at the boundary.
- Let inference do the work on locals; annotate public signatures.
- Keep types next to the code that owns them.
- Run strict mode and fix the root cause of each error.`),
  skill('javascript', 'JavaScript', 'Languages', 'Write predictable modern JavaScript', `Prefer explicit behavior over clever shortcuts.

- Use strict mode and block-scoped declarations.
- Handle promise rejections; never leave a floating promise.
- Prefer array methods with clear intent over index loops.
- Treat null and undefined distinctly at boundaries.
- Avoid implicit coercion in comparisons and arithmetic.`),
  skill('python', 'Python', 'Languages', 'Write clear, typed Python', `Favor readability and small functions.

- Use type hints on public functions and run a type checker.
- Prefer dataclasses or typed dicts over loose dictionaries.
- Use context managers for files, locks, and connections.
- Avoid mutable default arguments.
- Keep imports explicit and grouped by standard library, third party, local.`),
  skill('go', 'Go', 'Languages', 'Write simple, explicit Go', `Return errors and handle them at the call site.

- Wrap errors with context using fmt.Errorf and the %w verb.
- Keep interfaces small and define them where they are consumed.
- Pass context.Context through every call that can block.
- Avoid goroutines without a clear owner and exit path.
- Use the race detector in tests.`),
  skill('rust', 'Rust', 'Languages', 'Ownership-first Rust', `Let the borrow checker guide the design instead of fighting it.

- Prefer borrowing over cloning; clone only with a reason.
- Model absence with Option and failure with Result.
- Avoid unwrap and expect outside tests and prototypes.
- Keep unsafe blocks small, documented, and covered by tests.
- Split modules by responsibility, not by type category.`),
  skill('swift', 'Swift', 'Languages', 'Modern, safe Swift', `Use the type system and optionals deliberately.

- Prefer structs and value semantics unless identity is required.
- Handle optionals with guard let or if let, not force unwraps.
- Use async and await with structured concurrency tasks.
- Keep views small and state owned by the right level.
- Mark shared mutable state with the appropriate actor isolation.`),
  skill('kotlin', 'Kotlin', 'Languages', 'Concise, null-safe Kotlin', `Prefer immutable data and explicit nullability.

- Use data classes for value objects and sealed classes for states.
- Avoid the not-null assertion operator; handle null explicitly.
- Prefer coroutines with structured scopes over raw threads.
- Keep extension functions close to their receivers.
- Use idiomatic collection operations instead of manual loops.`),
  skill('java', 'Java', 'Languages', 'Maintainable modern Java', `Favor clarity and small, testable classes.

- Use records for immutable data carriers.
- Prefer constructor injection over field injection.
- Handle checked exceptions deliberately; do not wrap and ignore.
- Use Optional at return types, not as fields.
- Keep stream pipelines short enough to read.`),
  skill('c-sharp', 'C sharp', 'Languages', 'Clear, modern C#', `Use the language features that remove boilerplate without hiding behavior.

- Prefer nullable reference types and fix the warnings.
- Use records for immutable data and pattern matching for branching.
- Make async methods return Task and avoid async void.
- Dispose resources with using declarations.
- Keep LINQ queries readable and avoid repeated enumeration.`),
  skill('sql', 'SQL', 'Languages', 'Correct and efficient SQL', `State the question in plain language, then write the query that answers it.

- Read the execution plan before tuning.
- Filter early and select only needed columns.
- Verify join cardinality so rows are not duplicated or dropped.
- Use parameters, never string concatenation, for values.
- Check null behavior in filters and aggregates.`),
];
