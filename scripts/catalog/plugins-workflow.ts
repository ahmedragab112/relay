import { command, plugin, type PluginSeed } from './types.js';

export const workflowPlugins: PluginSeed[] = [
  plugin('onboarding-kit', 'Onboarding kit', 'Commands for codebase onboarding docs.', [
    command('onboard', 'Write an onboarding guide', `Write the onboarding guide for the repo the user describes.

1. Start with the fastest path to a running app.
2. List the accounts and tools only.
3. Name the five files a newcomer should read first.
4. Include the errors new people actually hit.`),
    command('tour', 'Give a code tour', `Give a guided tour of the code the user describes.

1. Trace one request end to end.
2. Name the boundary each file owns.
3. Point at the places that surprise people.
4. End with where a change usually starts.`),
  ]),
  plugin('triage-kit', 'Triage kit', 'Commands for issue triage and bug reports.', [
    command('triage-issue', 'Triage an issue', `Triage the issue the user provides.

1. Reproduce or ask for the missing reproduction.
2. Classify as bug, request, or confusion.
3. Find the owning area and the last change there.
4. Set priority by impact and frequency.`),
    command('bug-report', 'Write a bug report', `Write a bug report for the problem the user describes.

1. State expected and actual behavior in one line each.
2. Give the shortest reproduction.
3. Include versions and environment.
4. Say what you already ruled out.`),
  ]),
  plugin('planning-kit', 'Planning kit', 'Commands for sprint and project planning.', [
    command('plan-sprint', 'Plan a sprint', `Plan the sprint for the team the user describes.

1. Start from capacity, not wish lists.
2. Carry unfinished work only with a reason.
3. Reserve time for bugs and support.
4. Name the one thing that must ship.`),
    command('plan-project', 'Plan a project', `Plan the project the user describes.

1. Define milestones by outcomes, not dates alone.
2. Identify the critical path and the unknowns.
3. Put decisions with owners and deadlines.
4. State the assumption most likely to break.`),
  ]),
  plugin('estimation-kit', 'Estimation kit', 'Commands for sizing work and forecasts.', [
    command('estimate', 'Estimate a task', `Estimate the task the user describes.

1. Break it into steps smaller than a day.
2. Estimate the unknowns as ranges.
3. Add integration and review time explicitly.
4. State what would change the estimate most.`),
    command('forecast', 'Forecast delivery', `Forecast delivery for the work the user describes.

1. Use recent throughput, not optimism.
2. Give a range and the confidence behind it.
3. Show what happens if one dependency slips.
4. Name what is excluded from the forecast.`),
  ]),
  plugin('review-ops', 'Review ops', 'Commands for review process and load.', [
    command('review-load', 'Balance review load', `Balance review load for the team the user describes.

1. Count open reviews and their age.
2. Find reviewers who are consistently overloaded.
3. Set a response target for first review.
4. Rotate ownership of the review queue.`),
    command('review-sla', 'Write a review policy', `Write a review policy for the team the user describes.

1. Define what a review must check.
2. Set size limits that keep reviews fast.
3. Say who can approve what.
4. Make the exception path explicit.`),
  ]),
  plugin('hiring-kit', 'Hiring kit', 'Commands for interview loops and scorecards.', [
    command('loop-design', 'Design an interview loop', `Design the loop for the role the user describes.

1. Map each stage to a signal it must produce.
2. Remove stages that duplicate signal.
3. Write the scorecard before the first interview.
4. Keep the loop short enough to respect candidates.`),
    command('scorecard-review', 'Review scorecards', `Review the scorecards the user provides.

1. Check evidence, not impressions.
2. Find signals that were never tested.
3. Compare against the bar, not each other.
4. Record the decision and its reason.`),
  ]),
  plugin('handoff-kit', 'Handoff kit', 'Commands for transferring work cleanly.', [
    command('handoff', 'Write a handoff note', `Write the handoff for the work the user describes.

1. State current state and the next step.
2. List what is blocked and on whom.
3. Point at the open branches and decisions.
4. Name the gotchas that cost you time.`),
    command('handoff-review', 'Review a handoff', `Review the handoff the user provides.

1. Can someone continue without asking questions?
2. Are the risky areas called out?
3. Is the next action unambiguous?
4. Is anything only in someone's head?`),
  ]),
  plugin('incident-comms', 'Incident comms', 'Commands for status updates during incidents.', [
    command('status-update', 'Write a status update', `Write a status update for the incident the user describes.

1. State impact in user terms.
2. Give the current mitigation and its status.
3. Set the next update time.
4. Avoid speculation about cause until confirmed.`),
    command('postmortem', 'Write a postmortem', `Write the postmortem for the incident the user describes.

1. Build a timeline from logs, not memory.
2. Distinguish trigger from underlying causes.
3. List what worked as well as what failed.
4. Assign owners to every action.`),
  ]),
  plugin('knowledge-base', 'Knowledge base', 'Commands for internal docs and runbooks.', [
    command('runbook', 'Write a runbook', `Write the runbook for the system the user describes.

1. Start with the symptom that sends someone here.
2. List checks in order, with expected output.
3. Give the safe fix and the rollback.
4. Say who to page and when.`),
    command('kb-review', 'Review knowledge base pages', `Review the pages the user provides.

1. Check each page answers one question.
2. Verify commands still work.
3. Find pages that contradict each other.
4. Retire pages that only describe the past.`),
  ]),
  plugin('automation-kit', 'Automation kit', 'Commands for scripts and scheduled jobs.', [
    command('automate', 'Automate a workflow', `Automate the workflow the user describes.

1. Write the manual steps down first.
2. Automate only the deterministic steps.
3. Make reruns safe and observable.
4. Define how failures reach a person.`),
    command('automation-review', 'Review an automation', `Review the automation the user describes.

1. Check it cannot delete or overwrite blindly.
2. Verify secrets come from the environment.
3. Confirm it logs what it changed.
4. Find the state where a rerun doubles something.`),
  ]),
  plugin('threat-model-kit', 'Threat model kit', 'Commands for threat modeling systems.', [
    command('threat-model', 'Threat model a system', `Threat model the system the user describes.

1. Draw the trust boundaries first.
2. List assets and who wants them.
3. Enumerate threats per boundary.
4. Rank by reachable impact, then propose controls.`),
    command('threat-review', 'Review a threat model', `Review the threat model the user provides.

1. Look for boundaries that were drawn wrong.
2. Check each threat has a control or a decision.
3. Find insider and supply-chain paths.
4. Verify mitigations are testable.`),
  ]),
  plugin('audit-kit', 'Audit kit', 'Commands for security reviews of code and access.', [
    command('audit-code', 'Audit code for security', `Audit the code the user describes.

1. Trace every input to its sinks.
2. Check authentication and authorization on every entry.
3. Look for secrets and unsafe defaults.
4. Rank findings by exploitability.`),
    command('audit-access', 'Audit access', `Audit access for the system the user describes.

1. List principals and their permissions.
2. Find permissions wider than the task needs.
3. Check offboarding removes access.
4. Verify admin actions are logged.`),
  ]),
  plugin('secrets-kit', 'Secrets kit', 'Commands for secret storage and rotation.', [
    command('secret-plan', 'Plan secret management', `Plan secret management for the system the user describes.

1. Inventory secrets and their owners.
2. Choose storage per environment.
3. Plan rotation without downtime.
4. Make leaks detectable quickly.`),
    command('secret-review', 'Review secret handling', `Review secret handling in the code the user describes.

1. Check nothing is committed or logged.
2. Verify secrets load from the environment at runtime.
3. Confirm least privilege per secret.
4. Look for long-lived credentials that could rotate.`),
  ]),
  plugin('dependency-kit', 'Dependency kit', 'Commands for dependency review and upgrades.', [
    command('dependency-review', 'Review dependencies', `Review the dependencies the user describes.

1. Check maintenance activity and release cadence.
2. Compare bundle size and transitive count.
3. Look for licenses incompatible with the project.
4. Prefer the platform built-in when it is enough.`),
    command('upgrade-plan', 'Plan a dependency upgrade', `Plan the upgrade the user describes.

1. Read the changelog between versions.
2. List breaking changes that touch the code.
3. Upgrade in small steps with tests green.
4. Keep the rollback path available.`),
  ]),
  plugin('supply-chain-kit', 'Supply chain kit', 'Commands for build and artifact integrity.', [
    command('chain-review', 'Review the supply chain', `Review the supply chain for the build the user describes.

1. List every source of code and artifacts.
2. Verify downloads are pinned and checked.
3. Confirm CI credentials are scoped to the job.
4. Check artifacts can be reproduced.`),
    command('artifact-plan', 'Plan artifact signing', `Plan signing for the artifacts the user describes.

1. Choose what must be signed and why.
2. Separate signing keys from build machines.
3. Publish verification instructions.
4. Plan key rotation and revocation.`),
  ]),
  plugin('pentest-kit', 'Pentest kit', 'Commands for scoped assessments and findings.', [
    command('scope-test', 'Scope a security test', `Scope the test for the system the user describes.

1. List what is in and out of scope in writing.
2. Define safe testing windows and rate limits.
3. Name the contact for live findings.
4. Agree what happens if data is exposed.`),
    command('finding-report', 'Write a finding', `Write up the finding the user describes.

1. State the impact in one line.
2. Give reproduction steps a peer can follow.
3. Prove the exploit path, not just the smell.
4. Propose the fix and its trade-offs.`),
  ]),
  plugin('privacy-kit', 'Privacy kit', 'Commands for data handling reviews.', [
    command('data-map', 'Map personal data', `Map personal data for the system the user describes.

1. List each field and why it is collected.
2. Trace where it is stored and who reads it.
3. Define retention per field.
4. Confirm deletion reaches every copy.`),
    command('privacy-review', 'Review data handling', `Review data handling in the code the user describes.

1. Check collection is minimal for the feature.
2. Verify logs exclude sensitive fields.
3. Confirm consent gates what requires it.
4. Look for copies outside the retention policy.`),
  ]),
  plugin('compliance-kit', 'Compliance kit', 'Commands for control evidence and policy.', [
    command('control-evidence', 'Gather control evidence', `Gather evidence for the control the user describes.

1. Name the control and the risk it addresses.
2. List the artifacts that demonstrate it.
3. Verify dates cover the audit period.
4. Note gaps with a remediation date.`),
    command('policy-review', 'Review a policy', `Review the policy the user provides.

1. Check every rule has an owner and a check.
2. Find rules nobody can follow.
3. Align language with how the team works.
4. Set a review date.`),
  ]),
  plugin('backup-kit', 'Backup kit', 'Commands for backup and restore plans.', [
    command('backup-plan', 'Plan backups', `Plan backups for the system the user describes.

1. Set recovery point and recovery time targets.
2. Include configuration, not just data.
3. Store copies where one failure cannot take both.
4. Encrypt and restrict backup access.`),
    command('restore-drill', 'Plan a restore drill', `Plan a restore drill for the system the user describes.

1. Restore into an isolated environment.
2. Measure the time to usable state.
3. Verify data integrity against the source.
4. Record what did not work and fix it.`),
  ]),
  plugin('monitoring-kit', 'Monitoring kit', 'Commands for alerts and dashboards.', [
    command('alert-plan', 'Plan alerts', `Plan alerts for the system the user describes.

1. Alert on user-visible symptoms first.
2. Give every alert a runbook and an owner.
3. Set thresholds that do not page for noise.
4. Remove alerts that nobody acts on.`),
    command('monitoring-review', 'Review monitoring', `Review monitoring for the system the user describes.

1. Check the four signals: latency, traffic, errors, saturation.
2. Verify dashboards answer questions, not display data.
3. Confirm logs can find one request end to end.
4. Look for blind spots in the newest path.`),
  ]),
];
