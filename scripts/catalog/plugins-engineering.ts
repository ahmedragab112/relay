import { command, plugin, type PluginSeed } from './types.js';

export const engineeringPlugins: PluginSeed[] = [
  plugin('review-suite', 'Review suite', 'Slash commands for reviewing changes and whole files before they merge.', [
    command('review', 'Review local changes', `Review the current working tree.

1. Run git status and git diff, including staged changes.
2. Read the surrounding implementation for each changed area.
3. Report correctness and security findings first, with file and line.
4. End with the tests that should be added. Do not modify files.`),
    command('review-file', 'Review one file', `Review the file the user names, without changing it.

1. Read the whole file, not only the lines under discussion.
2. Look for correctness bugs, unsafe input handling, and missing error paths.
3. List findings by severity with a concrete fix for each.`),
  ]),
  plugin('debugging-suite', 'Debugging suite', 'Commands for reproducing failures and tracing a bad value to its source.', [
    command('debug', 'Debug a failure systematically', `Debug the reported failure without guessing.

1. Reproduce it and write the exact steps.
2. Read the full error and stack trace.
3. Form one hypothesis and test it with the smallest change.
4. Stop when the root cause is found and explain it before proposing a fix.`),
    command('trace', 'Trace a value through the code', `Trace the value the user reports back to where it is created.

1. Find every assignment and transformation of the value.
2. Identify the first point where it diverges from expectations.
3. Report the source and the correct place to fix it.`),
  ]),
  plugin('testing-suite', 'Testing suite', 'Commands for writing tests and planning coverage.', [
    command('write-tests', 'Write tests for a module', `Write tests for the target the user names.

1. Read the module and its public interface.
2. Cover the happy path, boundaries, and failure cases.
3. Name each test after the behavior, and assert on outcomes.
4. Run the tests and report the result.`),
    command('test-plan', 'Plan test coverage', `Produce a test plan for the change or feature described.

1. List the behaviors that must stay true.
2. Assign each to a unit, integration, or end-to-end test.
3. Name the highest-risk gaps first. Do not write the tests yet.`),
  ]),
  plugin('refactor-suite', 'Refactor suite', 'Commands for restructuring code without changing behavior.', [
    command('refactor', 'Refactor a section safely', `Refactor the section the user names.

1. Confirm the existing tests cover the behavior; add a test first if not.
2. Make one mechanical change at a time and rerun the tests.
3. Keep behavior identical and report what became clearer.`),
    command('extract', 'Extract a function or module', `Extract the repeated or tangled logic the user points at.

1. Identify the smallest piece with a single responsibility.
2. Give it a name that describes the outcome.
3. Update callers and run the tests.`),
  ]),
  plugin('docs-suite', 'Docs suite', 'Commands for documenting code and writing a project README.', [
    command('document', 'Document code in place', `Document the target the user names.

1. Explain why the code exists and the contract it promises.
2. Document inputs, outputs, and failure modes.
3. Keep comments to what the code cannot say itself.`),
    command('readme', 'Write or refresh the README', `Write a README for this project.

1. State what the project does and who it is for.
2. Add setup, run, and test commands that actually work.
3. List configuration and where it lives.
4. Verify every command before including it.`),
  ]),
  plugin('release-suite', 'Release suite', 'Commands for release notes and pre-release checks.', [
    command('release-notes', 'Draft release notes', `Draft release notes from the commits and diffs since the last release.

1. Group changes into Added, Changed, Fixed, and Removed.
2. Describe user-visible effects, not internal commits.
3. Put breaking changes first with migration steps.`),
    command('release-check', 'Run a pre-release check', `Check this project before a release.

1. Run the type check, tests, and build.
2. Look for uncommitted changes, debug logs, and TODOs.
3. Confirm the changelog and version match the change set.
4. Report blockers first.`),
  ]),
  plugin('git-suite', 'Git suite', 'Commands for commit messages and rebase planning.', [
    command('commit-message', 'Write a commit message', `Write a commit message for the staged changes.

1. Read the staged diff and the surrounding intent.
2. Use a short imperative subject under 72 characters.
3. Explain why in the body, not a line-by-line retelling.`),
    command('rebase-plan', 'Plan a rebase', `Plan a rebase of this branch onto the target branch.

1. List the commits that will be replayed.
2. Flag conflicts likely to occur and where.
3. Recommend squash, fixup, or reword per commit. Do not run history-changing commands.`),
  ]),
  plugin('performance-suite', 'Performance suite', 'Commands for profiling plans and targeted optimization.', [
    command('profile-plan', 'Plan a profiling session', `Plan how to profile the slow path the user describes.

1. State a measurable baseline.
2. Choose the profiler or timing method.
3. List the steps to isolate the dominant cost. Do not optimize yet.`),
    command('optimize', 'Optimize a measured bottleneck', `Optimize the bottleneck the user names.

1. Confirm it was measured, not assumed.
2. Make the smallest change that addresses the dominant cost.
3. Re-measure and report before and after.`),
  ]),
  plugin('security-suite', 'Security suite', 'Commands for security review and secret scanning.', [
    command('security-check', 'Review for security issues', `Review the target for security issues.

1. Trace user input to queries, files, shells, and HTML.
2. Check authorization per object, not only per route.
3. Report exploitability and severity with a concrete fix.`),
    command('secrets-scan', 'Scan for committed secrets', `Scan this project for secrets in files and history.

1. Look for keys, tokens, passwords, and private keys.
2. Check configuration and test fixtures too.
3. Report file and line, and recommend rotation. Do not print the secret.`),
  ]),
  plugin('migration-suite', 'Migration suite', 'Commands for planning migrations and safe mechanical rewrites.', [
    command('migration-plan', 'Plan a migration', `Plan the migration the user describes.

1. List the current and target states.
2. Break the work into backward-compatible steps.
3. Identify data changes, dual-run periods, and rollback.`),
    command('codemod', 'Write a codemod', `Write a mechanical codemod for the pattern the user names.

1. Find every occurrence, including tests and docs.
2. Apply the transformation with a script or precise edits.
3. Run the tests and report remaining manual cases.`),
  ]),

  plugin('react-kit', 'React kit', 'Commands for React components and hooks.', [
    command('component', 'Build a React component', `Build the React component the user describes.

1. Keep it small with typed props.
2. Handle loading, empty, and error states.
3. Add keyboard accessibility.
4. Use keys that identify items in lists.`),
    command('hook', 'Build a React hook', `Build the React hook the user describes.

1. Define its inputs, outputs, and cleanup.
2. Avoid hidden global state.
3. Add a test that exercises the real behavior.`),
  ]),
  plugin('vue-kit', 'Vue kit', 'Commands for Vue components and composables.', [
    command('vue-component', 'Build a Vue component', `Build the Vue component the user describes.

1. Use the composition API with typed props and emits.
2. Derive state with computed instead of watchers.
3. Scope styles to the component.`),
    command('vue-composable', 'Build a Vue composable', `Build the Vue composable the user describes.

1. Return reactive state and explicit actions.
2. Clean up listeners on scope disposal.
3. Add a test using the real composable.`),
  ]),
  plugin('svelte-kit', 'Svelte kit', 'Commands for Svelte components and stores.', [
    command('svelte-component', 'Build a Svelte component', `Build the Svelte component the user describes.

1. Keep it reactive with derived statements, not duplicated state.
2. Use actions for DOM behavior.
3. Add accessible labels to controls.`),
    command('svelte-store', 'Build a Svelte store', `Build the Svelte store the user describes.

1. Keep it small and expose actions, not raw setters.
2. Document the update contract.
3. Unsubscribe correctly when used manually.`),
  ]),
  plugin('next-kit', 'Next.js kit', 'Commands for routes and server actions.', [
    command('route', 'Add a Next.js route', `Add the route the user describes.

1. Decide server, static, or client rendering and say why.
2. Handle loading and error states.
3. Keep secrets in server code only.`),
    command('server-action', 'Add a server action', `Add the server action the user describes.

1. Validate and authorize every input.
2. Revalidate the affected paths.
3. Return errors the form can display.`),
  ]),
  plugin('css-kit', 'CSS kit', 'Commands for auditing styles and building layouts.', [
    command('css-audit', 'Audit styles', `Audit the styles for the area the user names.

1. Find hard-coded colors, spacing, and type.
2. Flag duplicated selectors and specificity conflicts.
3. Propose token replacements. Do not change files yet.`),
    command('layout', 'Build a layout', `Build the layout the user describes.

1. Use grid or flexbox with explicit sizing rules.
2. Verify narrow and wide widths.
3. Keep component internals independent of page layout.`),
  ]),
  plugin('a11y-kit', 'Accessibility kit', 'Commands for accessibility and keyboard audits.', [
    command('a11y-audit', 'Audit accessibility', `Audit the screen or component the user names.

1. Check labels, roles, contrast, and focus order.
2. Test with a keyboard only.
3. List issues with severity and a concrete fix.`),
    command('keyboard-audit', 'Audit keyboard behavior', `Audit keyboard interaction for the target.

1. Reach every control with Tab.
2. Confirm focus is visible and never trapped.
3. Verify Escape and Enter do what users expect.`),
  ]),
  plugin('design-system-kit', 'Design system kit', 'Commands for token audits and component specifications.', [
    command('token-audit', 'Audit design tokens', `Audit tokens in the area the user names.

1. Find values that bypass tokens.
2. Group them by color, spacing, radius, and type.
3. Propose the token mapping and any missing tokens.`),
    command('component-spec', 'Write a component spec', `Write a spec for the component the user names.

1. List states, variants, and slots.
2. Define keyboard and screen reader behavior.
3. Note do and do-not usage.`),
  ]),
  plugin('animation-kit', 'Animation kit', 'Commands for planning and reviewing UI motion.', [
    command('motion-plan', 'Plan UI motion', `Plan the motion for the interaction the user describes.

1. Say what change the motion explains.
2. Choose duration, easing, and properties.
3. Include reduced-motion behavior.`),
    command('motion-review', 'Review existing motion', `Review the motion in the target the user names.

1. Check durations, easing, and property cost.
2. Flag motion that distracts or blocks input.
3. Confirm animations settle when state changes.`),
  ]),
  plugin('forms-kit', 'Forms kit', 'Commands for form structure and validation.', [
    command('form-schema', 'Design a form schema', `Design the form the user describes.

1. List fields with type, requiredness, and defaults.
2. Define validation on client and server.
3. Specify error placement and success feedback.`),
    command('validation', 'Add validation', `Add validation to the form the user names.

1. Validate at the boundary with precise messages.
2. Preserve input on failure.
3. Cover boundary values in tests.`),
  ]),
  plugin('seo-kit', 'SEO kit', 'Commands for search audits and page metadata.', [
    command('seo-audit', 'Audit search basics', `Audit the page the user names for search basics.

1. Check title, description, canonical, and headings.
2. Verify crawlability and internal links.
3. List fixes in impact order.`),
    command('metadata', 'Write page metadata', `Write metadata for the page the user describes.

1. Keep the title under 60 characters and description under 160.
2. Match the visible page content.
3. Add social sharing tags where useful.`),
  ]),
];
