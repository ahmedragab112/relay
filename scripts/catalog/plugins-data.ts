import { command, plugin, type PluginSeed } from './types.js';

export const dataPlugins: PluginSeed[] = [
  plugin('analytics-kit', 'Analytics kit', 'Commands for product analytics questions and event design.', [
    command('event-plan', 'Plan analytics events', `Plan the events for the feature the user describes.

1. Name each event by the user action it records.
2. List properties that make the event answerable later.
3. Mark events that must fire exactly once.
4. Remove events that no question depends on.`),
    command('funnel', 'Analyze a funnel', `Analyze the funnel the user describes.

1. Define each step and the population entering it.
2. Find where the largest drop-off happens.
3. Separate caused drops from expected ones.
4. Propose one concrete experiment per finding.`),
  ]),
  plugin('pandas-kit', 'pandas kit', 'Commands for dataframe cleaning and analysis.', [
    command('clean-frame', 'Clean a dataframe', `Clean the dataframe the user describes.

1. Profile dtypes, nulls, and duplicates first.
2. Fix parsing and types before filling values.
3. Drop or impute missing data with a stated rule.
4. Record every transformation so the result is reproducible.`),
    command('groupby', 'Write a groupby', `Write the aggregation the user describes.

1. State the grouping keys and the grain of the result.
2. Choose aggregations that survive missing groups.
3. Verify totals reconcile with the source.
4. Return a flat, named frame ready to chart.`),
  ]),
  plugin('sql-kit', 'SQL kit', 'Commands for analytic SQL and warehouse queries.', [
    command('query-plan', 'Plan an analytic query', `Plan the query for the question the user asks.

1. State the grain and the time window before writing SQL.
2. List the tables and join keys involved.
3. Handle nulls and duplicate rows deliberately.
4. Validate the result against a second, simpler query.`),
    command('window', 'Write a window query', `Write the windowed query the user describes.

1. Name the partition and ordering explicitly.
2. Choose the frame clause that matches the metric.
3. Handle ties and boundary rows.
4. Check the first and last group by hand.`),
  ]),
  plugin('viz-kit', 'Visualization kit', 'Commands for chart choice and dashboard layout.', [
    command('chart-choice', 'Choose a chart', `Choose a chart for the data the user describes.

1. Name the question the chart answers, then the data type.
2. Prefer position and length over area and color.
3. Justify the choice in one sentence, including what it cannot show.
4. Say when a small table beats any chart.`),
    command('dashboard', 'Lay out a dashboard', `Lay out the dashboard the user describes.

1. Lead with the decision the dashboard supports.
2. Put the most important metric top-left.
3. Keep one measure per chart and few colors.
4. Design the empty and error states before the happy path.`),
  ]),
  plugin('etl-kit', 'ETL kit', 'Commands for pipeline design and data quality checks.', [
    command('pipeline-design', 'Design a pipeline', `Design the pipeline the user describes.

1. Define source, contract, and freshness target.
2. Decide batch or streaming and justify it.
3. Make every stage idempotent and replayable.
4. Plan how failures are detected and rerun.`),
    command('quality-checks', 'Add data quality checks', `Add quality checks to the pipeline the user describes.

1. Check row counts and freshness on every run.
2. Assert uniqueness, non-null keys, and value ranges.
3. Fail loudly before bad data reaches consumers.
4. Alert with the failing check and a sample row.`),
  ]),
  plugin('warehouse-kit', 'Warehouse kit', 'Commands for warehouse modeling and cost.', [
    command('model-marts', 'Model a data mart', `Model the mart the user describes.

1. Pick the grain of the fact table first.
2. Add only dimensions consumers actually filter on.
3. Keep history with a stated strategy.
4. Document every measure and its source column.`),
    command('cost-review', 'Review warehouse cost', `Review warehouse cost for the workload the user describes.

1. Find the most expensive recurring queries.
2. Check clustering, partitioning, and scan width.
3. Materialize what is reused, not what is cheap.
4. Estimate savings per change before shipping it.`),
  ]),
  plugin('ml-kit', 'ML kit', 'Commands for model training plans and evaluation.', [
    command('train-plan', 'Plan a model training run', `Plan the training run the user describes.

1. State the prediction target and the decision it feeds.
2. Split data by time or group so the test set is honest.
3. Pick a baseline and one metric before tuning.
4. Log data version, config, and seed for every run.`),
    command('model-review', 'Review a model', `Review the model the user describes.

1. Check the split for leakage.
2. Compare against the baseline on the same test set.
3. Slice the metric by important segments.
4. State failure modes the metric would not catch.`),
  ]),
  plugin('eval-kit', 'Eval kit', 'Commands for LLM evaluation sets and scoring.', [
    command('eval-set', 'Build an eval set', `Build the eval set the user describes.

1. Start from real inputs, not invented ones.
2. Cover the common case, the edge cases, and the failures seen.
3. Write the expected behavior as a checkable assertion.
4. Keep the set small enough to run on every change.`),
    command('score-runs', 'Score model runs', `Score the runs the user describes.

1. Fix one rubric before looking at outputs.
2. Grade blind to which variant produced the output.
3. Report pass rate per category, not one average.
4. Inspect the failures by hand before trusting the score.`),
  ]),
  plugin('prompt-kit', 'Prompt kit', 'Commands for writing and reviewing prompts.', [
    command('write-prompt', 'Write a prompt', `Write the prompt the user describes.

1. State the role, the task, and the output shape.
2. Include only context the task needs.
3. Give one worked example instead of many rules.
4. Name the failure mode you most want to avoid.`),
    command('prompt-review', 'Review a prompt', `Review the prompt the user provides.

1. Check the output contract is unambiguous.
2. Find instructions that conflict with each other.
3. Remove context that invites hallucination.
4. Test the prompt against the three hardest inputs.`),
  ]),
  plugin('notebook-kit', 'Notebook kit', 'Commands for analysis notebooks and reproducibility.', [
    command('notebook-plan', 'Plan an analysis notebook', `Plan the notebook for the question the user asks.

1. Put one question at the top and the answer at the bottom.
2. Keep cells runnable top to bottom with no hidden state.
3. Move reusable logic into a module.
4. End with the decision and what would change it.`),
    command('reproduce', 'Make an analysis reproducible', `Make the analysis the user describes reproducible.

1. Pin data sources and versions.
2. Seed randomness and state the environment.
3. Verify a clean run produces the same numbers.
4. Note what still depends on manual steps.`),
  ]),
  plugin('ios-kit', 'iOS kit', 'Commands for Swift and UIKit work.', [
    command('swiftui-view', 'Write a SwiftUI view', `Write the view the user describes.

1. Model state with the smallest correct property wrapper.
2. Keep layout declarative and free of geometry hacks.
3. Support Dynamic Type and dark mode from the start.
4. Add previews for empty, long-content, and error states.`),
    command('ios-review', 'Review an iOS change', `Review the iOS change the user describes.

1. Check main-thread work and retain cycles.
2. Verify accessibility labels and tap targets.
3. Look for memory growth on repeated navigation.
4. Confirm the change behaves on the oldest supported OS.`),
  ]),
  plugin('android-kit', 'Android kit', 'Commands for Compose and Kotlin work.', [
    command('compose-screen', 'Write a Compose screen', `Write the screen the user describes.

1. Hoist state out of the composable.
2. Keep recomposition local with stable, immutable inputs.
3. Handle configuration changes without losing input.
4. Provide previews for loading, empty, and error states.`),
    command('android-review', 'Review an Android change', `Review the Android change the user describes.

1. Check lifecycle, coroutine scope, and cancellation.
2. Verify edge-to-edge insets and back handling.
3. Look for work on the main thread.
4. Confirm behavior on the minimum SDK.`),
  ]),
  plugin('flutter-kit', 'Flutter kit', 'Commands for widget structure and Dart.', [
    command('widget-split', 'Split a Flutter widget', `Restructure the widget the user describes.

1. Separate stateful containers from stateless presentation.
2. Pass only the values each subtree needs.
3. Constrain rebuilds with the right keys and scopes.
4. Keep theme access and text styles centralized.`),
    command('flutter-review', 'Review a Flutter change', `Review the Flutter change the user describes.

1. Check rebuild cost and const usage.
2. Verify layout on narrow and large screens.
3. Confirm async work is cancelled on dispose.
4. Add a widget test for the changed behavior.`),
  ]),
  plugin('rn-kit', 'React Native kit', 'Commands for native mobile features in React Native.', [
    command('rn-feature', 'Plan a React Native feature', `Plan the feature the user describes.

1. Decide what belongs in JS and what needs native code.
2. Handle permissions and denial paths explicitly.
3. Plan offline and slow-network behavior.
4. Name the devices and OS versions to verify.`),
    command('rn-review', 'Review a React Native change', `Review the React Native change the user describes.

1. Check list virtualization and image sizing.
2. Verify navigation state survives backgrounding.
3. Look for platform-specific branches without tests.
4. Confirm the change on both iOS and Android.`),
  ]),
  plugin('electron-kit', 'Electron kit', 'Commands for desktop app architecture and security.', [
    command('ipc-design', 'Design an IPC channel', `Design the IPC the user describes.

1. Keep the renderer sandboxed with context isolation on.
2. Expose the smallest typed surface through preload.
3. Validate every argument in the main process.
4. Never pass raw file paths or shell strings from the renderer.`),
    command('electron-review', 'Review an Electron change', `Review the Electron change the user describes.

1. Check node integration stays off in renderers.
2. Verify external links open outside the app.
3. Look for blocking work on the main process.
4. Confirm packaging includes every runtime asset.`),
  ]),
  plugin('desktop-kit', 'Desktop kit', 'Commands for native menus, shortcuts, and windows.', [
    command('menu-plan', 'Plan app menus and shortcuts', `Plan menus and shortcuts for the app the user describes.

1. Match platform conventions per OS.
2. Give every command a discoverable menu path.
3. Avoid shortcuts the OS already claims.
4. Show chords in menus, not only in docs.`),
    command('window-behavior', 'Define window behavior', `Define window behavior for the app the user describes.

1. Remember size and position across launches.
2. Restore the last workspace on reopen.
3. Handle multiple windows without shared mutable state.
4. Define what closing and quitting each do.`),
  ]),
  plugin('offline-kit', 'Offline kit', 'Commands for offline-first data and sync.', [
    command('sync-plan', 'Plan offline sync', `Plan sync for the app the user describes.

1. Define what works with no network.
2. Choose conflict resolution per data type.
3. Queue writes durably and retry with backoff.
4. Show sync state in the interface without blocking work.`),
    command('conflict-review', 'Review conflict handling', `Review conflict handling in the code the user describes.

1. Find every place two writers can touch one record.
2. Confirm the merge rule is deterministic.
3. Verify data is never silently dropped.
4. Test the interleavings that matter, not all of them.`),
  ]),
  plugin('push-kit', 'Push kit', 'Commands for notifications and delivery.', [
    command('notification-plan', 'Plan notifications', `Plan notifications for the feature the user describes.

1. Notify only when the user cannot act in the app.
2. Write copy that stands alone on a lock screen.
3. Group and throttle by topic.
4. Respect quiet hours and per-topic opt-outs.`),
    command('delivery-review', 'Review notification delivery', `Review delivery for the feature the user describes.

1. Check permission requests happen with context.
2. Verify tokens are refreshed and pruned.
3. Handle failures without duplicate sends.
4. Measure opens, not just sends.`),
  ]),
  plugin('store-kit', 'App store kit', 'Commands for release notes and store review.', [
    command('release-notes', 'Write store release notes', `Write release notes for the release the user describes.

1. Lead with what users can now do.
2. Group by theme, not by commit.
3. Mention fixes only when users felt them.
4. Keep it short enough to read in the store.`),
    command('review-prep', 'Prepare for app review', `Prepare the submission the user describes.

1. Check permission strings explain the real use.
2. Confirm demo credentials and review notes are current.
3. Look for features that need a policy disclosure.
4. List what changed since the last approved build.`),
  ]),
  plugin('deeplink-kit', 'Deep link kit', 'Commands for URL schemes and universal links.', [
    command('link-plan', 'Plan deep links', `Plan deep links for the app the user describes.

1. Define the URL space before implementing.
2. Handle cold start and warm start separately.
3. Fall back to a web page when the app is missing.
4. Validate parameters before navigation.`),
    command('link-review', 'Review deep link handling', `Review link handling in the code the user describes.

1. Check untrusted parameters never reach sensitive actions.
2. Verify links survive login and onboarding.
3. Confirm expired and malformed links fail safely.
4. Test on a device with the app uninstalled.`),
  ]),
];
