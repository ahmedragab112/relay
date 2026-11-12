import { skill, type SkillSeed } from './types.js';

export const mobileSkills: SkillSeed[] = [
  skill('swiftui', 'SwiftUI', 'Mobile & desktop', 'Composable SwiftUI views', `Keep state ownership explicit and views small.

- Use @State for local view state and observable models for shared state.
- Extract subviews instead of long bodies.
- Prefer view models for async work; keep views declarative.
- Use accessibility labels for icon-only controls.
- Preview both light and dark appearance.`),
  skill('jetpack-compose', 'Jetpack Compose', 'Mobile & desktop', 'Composable Android screens', `Compose UI from state and hoist what should be shared.

- Hoist state out of leaf composables.
- Keep recomposition scoped; avoid unstable parameters.
- Use effects for side work, not composition bodies.
- Test with semantics, not pixels.
- Handle configuration changes without losing input.`),
  skill('flutter', 'Flutter', 'Mobile & desktop', 'Efficient Flutter widgets', `Minimize rebuild scope and keep widgets focused.

- Split large widgets so setState repaints less.
- Use const constructors where possible.
- Keep business logic out of build methods.
- Handle loading, error, and empty states explicitly.
- Test widget behavior with the widget tester.`),
  skill('react-native', 'React Native', 'Mobile & desktop', 'Native-feeling React Native', `Respect platform conventions and the main thread.

- Use FlatList for long collections and stable keys.
- Keep animation work off the JS thread where possible.
- Handle safe areas and keyboard avoidance.
- Test on both platforms; do not assume parity.
- Request permissions at the moment of use.`),
  skill('electron', 'Electron', 'Mobile & desktop', 'Secure desktop apps with Electron', `Treat the renderer as untrusted.

- Keep node integration off and context isolation on.
- Expose a narrow API through the preload bridge.
- Validate every IPC argument in the main process.
- Deny navigation and new windows by default.
- Store secrets with the platform keychain.`),
  skill('macos-appkit', 'macOS AppKit', 'Mobile & desktop', 'Native macOS windows and menus', `Follow the platform: windows, menus, and keyboard behavior.

- Put commands in the menu bar with standard shortcuts.
- Respect window restoration and minimum sizes.
- Use sheets for blocking actions, panels for inspection.
- Support full keyboard navigation and VoiceOver labels.
- Follow system appearance and accent color.`),
  skill('offline-first', 'Offline-first', 'Mobile & desktop', 'Work without a connection', `Assume the network is slow, flaky, and sometimes absent.

- Store writes locally and sync later.
- Make sync operations idempotent.
- Resolve conflicts with an explicit rule and show it to the user.
- Queue requests and retry with backoff.
- Show sync state honestly.`),
  skill('push-notifications', 'Push notifications', 'Mobile & desktop', 'Notifications people appreciate', `Notify only when the user would act.

- Ask for permission in context, not at first launch.
- Keep payloads free of sensitive data.
- De-duplicate and collapse related notifications.
- Deep-link into the right screen.
- Honor quiet hours and per-type preferences.`),
  skill('app-store-release', 'App Store release', 'Mobile & desktop', 'Ship a store update smoothly', `Plan the release like a product launch.

- Update metadata, screenshots, and privacy answers before submission.
- Test on the oldest supported OS.
- Stage the rollout and watch crash rates.
- Write release notes users understand.
- Keep a rollback or hotfix plan ready.`),
  skill('deep-links', 'Deep links', 'Mobile & desktop', 'Links that open the right place', `Handle links as untrusted input.

- Parse and validate every parameter.
- Handle cold start, warm start, and already-open states.
- Fall back to a safe screen when the target is missing.
- Keep a single routing table for all link types.
- Test links from messages, browsers, and other apps.`),

  skill('git-workflow', 'Git workflow', 'Workflow', 'Branches and commits that stay reviewable', `Keep history readable and changes small.

- Branch from the latest main and rebase before review.
- Make one logical change per commit.
- Write commit messages that explain why.
- Never commit secrets or generated junk.
- Rebase your own branch; merge shared branches.`),
  skill('code-ownership', 'Code ownership', 'Workflow', 'Know who decides and who reviews', `Make ownership explicit so changes find the right reviewer.

- Keep CODEOWNERS current.
- Assign a primary owner per area.
- Require review from owners for risky paths.
- Document escalation when owners are unavailable.
- Rotate ownership to avoid single points of failure.`),
  skill('issue-triage', 'Issue triage', 'Workflow', 'Turn reports into actionable work', `Reproduce before judging.

- Capture version, environment, and exact steps.
- Classify: bug, request, question, duplicate.
- Assign severity by user impact, not loudness.
- Link related issues and prior fixes.
- State the next action and owner.`),
  skill('sprint-planning', 'Sprint planning', 'Workflow', 'Plan work that can actually finish', `Plan from capacity, not from ambition.

- Start with carryover and known interruptions.
- Break work until each item is independently shippable.
- Include review and testing time.
- Agree on the sprint goal in one sentence.
- Leave slack for unplanned work.`),
  skill('estimation', 'Estimation', 'Workflow', 'Estimates you can defend', `Estimate ranges, not single numbers.

- Split work until each piece is familiar.
- Compare against similar past work.
- State assumptions that drive the estimate.
- Separate unknowns into a spike.
- Re-estimate when scope changes.`),
  skill('codebase-onboarding', 'Codebase onboarding', 'Workflow', 'Understand a codebase quickly', `Map the system before changing it.

- Read the README, then the entry point, then the tests.
- Trace one real request end to end.
- Identify the build, test, and deploy commands.
- Note the boundaries between modules.
- Write down what surprised you; it helps the next person.`),
  skill('monorepo', 'Monorepo', 'Workflow', 'Many packages, one repository', `Keep package boundaries honest and builds incremental.

- Give each package one responsibility and an explicit public entry point.
- Avoid deep imports across packages.
- Cache builds and tests per package in CI.
- Version internal packages consistently.
- Run affected-only checks for pull requests.`),
  skill('legacy-modernization', 'Legacy modernization', 'Workflow', 'Replace old systems safely', `Strangle the old system behind a stable interface.

- Characterize current behavior with tests before changing it.
- Introduce a seam at the boundary you want to replace.
- Migrate one path at a time behind a flag.
- Keep data compatible during dual-run.
- Delete the legacy path only after traffic moves.`),
  skill('cost-optimization', 'Cost optimization', 'Workflow', 'Spend less without hurting reliability', `Find the largest cost before cutting anything.

- Attribute spend by service and environment.
- Remove idle resources and overspecified instances.
- Right-size storage and retention policies.
- Cache or batch expensive repeated work.
- Track cost per request or per user afterward.`),
  skill('documentation-audit', 'Documentation audit', 'Workflow', 'Docs that are true today', `Find the docs that mislead people.

- List entry points new engineers use.
- Run every command in the setup guide.
- Check screenshots and links for staleness.
- Mark or delete pages that no longer apply.
- Assign an owner and a review date to living docs.`),
];
