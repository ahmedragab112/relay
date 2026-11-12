import { skill, type SkillSeed } from './types.js';

export const devopsSkills: SkillSeed[] = [
  skill('docker', 'Docker', 'DevOps', 'Small, reproducible images', `Build images that run the same everywhere.

- Start from a pinned base image and update deliberately.
- Copy dependency manifests before source so layers cache.
- Run as a non-root user.
- Keep secrets out of layers and build args.
- Use a multi-stage build to ship only runtime files.`),
  skill('kubernetes', 'Kubernetes', 'DevOps', 'Declarative workloads that recover', `Describe desired state and let the controller reconcile.

- Set resource requests and limits.
- Define readiness and liveness probes that reflect real health.
- Use namespaces and least-privilege service accounts.
- Keep secrets in the platform secret store.
- Pin image tags; avoid latest in production.`),
  skill('ci-cd', 'CI/CD', 'DevOps', 'Pipelines that fail fast', `Keep feedback fast and failures obvious.

- Run cheap checks first: lint, types, unit tests.
- Cache dependencies keyed by the lockfile.
- Make every step reproducible outside the pipeline.
- Fail on flaky tests instead of retrying silently.
- Gate deploys on tests and a reviewable artifact.`),
  skill('github-actions', 'GitHub Actions', 'DevOps', 'Reliable workflow files', `Treat workflows as code with the same care as application code.

- Pin third-party actions to a commit SHA.
- Restrict permissions to the minimum the job needs.
- Use environments and required reviewers for deploys.
- Cache and matrix deliberately; do not multiply jobs without reason.
- Keep secrets in repository or environment secrets, never in workflow files.`),
  skill('terraform', 'Terraform', 'DevOps', 'Infrastructure that can be reviewed', `Make every change visible in a plan before it is applied.

- Keep state in a remote backend with locking.
- Split environments into separate state files.
- Use modules for repeated patterns, not for one-off resources.
- Tag resources with owner and purpose.
- Review plans for deletions before approving.`),
  skill('linux-shell', 'Linux shell', 'DevOps', 'Safe, readable scripts', `Write scripts that fail loudly and leave evidence.

- Start bash scripts with set -euo pipefail.
- Quote variables and check required arguments.
- Use a temporary directory and clean it up with trap.
- Prefer long option names in scripts for readability.
- Test destructive commands with a dry run first.`),
  skill('nginx', 'Nginx', 'DevOps', 'Reverse proxy and static serving', `Get caching, headers, and TLS right before optimizing.

- Proxy to upstreams with explicit timeouts.
- Set security headers at the edge.
- Serve static assets with long cache headers and hashed names.
- Redirect HTTP to HTTPS and enable modern TLS.
- Validate configuration with nginx -t before reloading.`),
  skill('secrets-management', 'Secrets management', 'DevOps', 'Keep credentials out of code and logs', `Assume any committed secret is already leaked.

- Load secrets from the platform or a secret manager at runtime.
- Scope secrets per service and rotate them regularly.
- Never print secrets; redact them in logs and error output.
- Prefer workload identity over long-lived keys.
- Revoke and rotate immediately when exposure is suspected.`),
  skill('incident-response', 'Incident response', 'DevOps', 'Stabilize first, explain later', `Restore service, then understand the cause.

- Declare the incident and assign a single coordinator.
- Mitigate with a rollback, feature flag, or failover before root-causing.
- Keep a timestamped log of actions and decisions.
- Communicate status at fixed intervals.
- Write the postmortem blamelessly with concrete follow-ups.`),
  skill('release-management', 'Release management', 'DevOps', 'Ship predictably and reversibly', `Make every release small, observable, and reversible.

- Keep a changelog users can understand.
- Ship behind a flag when the change is risky.
- Verify the release in production with a smoke check.
- Know the rollback command before deploying.
- Announce breaking changes ahead of time.`),

  skill('unit-testing', 'Unit testing', 'Testing & security', 'Focused tests that catch regressions', `Test behavior through the public interface.

- One behavior per test with a name that states the expectation.
- Cover the happy path, boundaries, and error cases.
- Avoid mocking what you own; test real code where practical.
- Keep tests independent and fast.
- Assert on outcomes, never on internal calls.`),
  skill('integration-testing', 'Integration testing', 'Testing & security', 'Test real boundaries', `Test the seams between parts, not every line again.

- Use real databases and queues where feasible; reset state between tests.
- Cover transactions, retries, and timeouts.
- Verify error translation across boundaries.
- Keep fixtures small and named for the scenario.
- Run integration tests in CI against the same versions as production.`),
  skill('end-to-end-testing', 'End-to-end testing', 'Testing & security', 'Flows that prove the product works', `Test the journeys users actually take.

- Cover sign-in, the primary task, and recovery from failure.
- Select elements by role or stable test id, not styling.
- Wait for real conditions instead of fixed sleeps.
- Keep suites small and parallel where possible.
- Capture artifacts on failure: screenshot, console, network.`),
  skill('contract-testing', 'Contract testing', 'Testing & security', 'Keep services compatible', `Publish and verify the shape each service promises.

- Define the contract in the provider pipeline.
- Verify consumers against the published contract.
- Version breaking changes.
- Run contract tests before deploy, not after.
- Fail the build when a contract changes without review.`),
  skill('property-testing', 'Property testing', 'Testing & security', 'Find edge cases with generated input', `State the invariant, then let generated inputs try to break it.

- Start with small sizes and a fixed seed for reproducibility.
- Shrink failures to the smallest counterexample.
- Cover parsers, encoders, and state machines.
- Keep properties independent of the implementation.
- Turn every found bug into a regression example.`),
  skill('load-testing', 'Load testing', 'Testing & security', 'Know the limit before users find it', `Measure throughput and latency under realistic traffic.

- Model real request mixes and think times.
- Find the knee of the latency curve, not just maximum load.
- Test the whole path including dependencies.
- Watch resources and error rates during the run.
- Record the environment so results are comparable.`),
  skill('code-coverage', 'Code coverage', 'Testing & security', 'Use coverage as a flashlight', `Coverage shows what was never executed, not what is correct.

- Aim for coverage of risky and complex paths.
- Never chase a percentage with assertion-free tests.
- Review uncovered branches after a change.
- Track coverage trends, not absolutes.
- Combine with mutation testing for critical modules.`),
  skill('static-analysis', 'Static analysis', 'Testing & security', 'Catch problems before running', `Make the analyzer part of the build, not a suggestion.

- Enable strict type checking and fail the build on errors.
- Add security and correctness linters for the language.
- Fix root causes instead of suppressing warnings.
- Review every suppression with an expiry.
- Keep the toolchain version pinned.`),
  skill('security-review', 'Security review', 'Testing & security', 'Look for the exploitable path', `Think like an attacker with the access the feature grants.

- Trace user input to every sink: queries, files, shells, HTML.
- Check authorization on every object, not only the route.
- Look for secrets in logs, errors, and client bundles.
- Verify rate limits on expensive and sensitive endpoints.
- Report exploitability and severity, with a concrete fix.`),
  skill('threat-modeling', 'Threat modeling', 'Testing & security', 'Design out the obvious attacks', `Map the system, then ask what can go wrong at each boundary.

- List assets, actors, and trust boundaries.
- Enumerate threats per boundary: spoofing, tampering, disclosure, denial, escalation.
- Rank by likelihood and impact.
- Choose mitigations and make them testable.
- Revisit the model when the architecture changes.`),
];
