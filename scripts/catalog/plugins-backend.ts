import { command, plugin, type PluginSeed } from './types.js';

export const backendPlugins: PluginSeed[] = [
  plugin('api-kit', 'API kit', 'Commands for designing endpoints and reviewing HTTP APIs.', [
    command('endpoint', 'Design an endpoint', `Design the endpoint the user describes.

1. Choose the resource, method, and status codes.
2. Define request and response shapes with validation rules.
3. Cover authorization, pagination, and errors.
4. Note what is idempotent.`),
    command('api-review', 'Review an HTTP API', `Review the API surface the user names.

1. Check naming, status codes, and error shapes.
2. Verify input validation and authorization.
3. Flag breaking changes and missing pagination.`),
  ]),
  plugin('graphql-kit', 'GraphQL kit', 'Commands for schema design and resolvers.', [
    command('schema', 'Design a GraphQL schema', `Design the schema for the feature the user describes.

1. Model types around client use cases.
2. Make nullability honest.
3. Plan pagination and error representation.`),
    command('resolver', 'Write a resolver', `Write the resolver the user describes.

1. Authorize at the field boundary.
2. Batch and cache lookups to avoid N+1 queries.
3. Test success and failure paths.`),
  ]),
  plugin('postgres-kit', 'Postgres kit', 'Commands for query review and index planning.', [
    command('query-review', 'Review a SQL query', `Review the query the user provides.

1. Check join cardinality and null behavior.
2. Read the execution plan.
3. Suggest indexes or rewrites with expected effect.`),
    command('index-plan', 'Plan indexes', `Plan indexes for the workload the user describes.

1. List the filters, joins, and sort orders.
2. Propose composite indexes in the right column order.
3. Note write cost and redundant indexes.`),
  ]),
  plugin('auth-kit', 'Auth kit', 'Commands for authentication review and permission mapping.', [
    command('auth-review', 'Review authentication', `Review the authentication flow the user names.

1. Check password hashing, token expiry, and rotation.
2. Verify cookie flags and CSRF protection.
3. Review login and reset rate limits.`),
    command('permission-matrix', 'Map permissions', `Build a permission matrix for the roles the user describes.

1. List resources and actions.
2. Assign each role the minimum permissions.
3. Flag ambiguous or conflicting grants.`),
  ]),
  plugin('queue-kit', 'Queue kit', 'Commands for job design and retry policy.', [
    command('job-design', 'Design a background job', `Design the job the user describes.

1. Define the payload and its size limits.
2. Make the handler idempotent.
3. Specify timeouts, retries, and dead-letter behavior.`),
    command('retry-policy', 'Design a retry policy', `Design retries for the operation the user describes.

1. Classify which failures are retryable.
2. Choose backoff and a retry cap.
3. Define what happens after exhaustion.`),
  ]),
  plugin('cache-kit', 'Cache kit', 'Commands for cache planning and invalidation.', [
    command('cache-plan', 'Plan a cache', `Plan caching for the data the user describes.

1. Decide what to cache and for how long.
2. Choose the key from everything that changes the result.
3. Protect the origin from a cold-start stampede.`),
    command('invalidation', 'Design invalidation', `Design invalidation for the cache the user describes.

1. List the writes that make entries stale.
2. Choose invalidation on write or short TTLs.
3. Describe the user-visible effect of staleness.`),
  ]),
  plugin('observability-kit', 'Observability kit', 'Commands for instrumentation and dashboards.', [
    command('instrument', 'Instrument a service', `Instrument the path the user describes.

1. Add structured logs with request and trace ids.
2. Record latency, errors, and saturation.
3. Keep sensitive values out of logs.`),
    command('dashboard', 'Design a dashboard', `Design the dashboard for the service the user describes.

1. Put user-facing health at the top.
2. Show error rate, latency, and saturation.
3. Keep it readable at a glance.`),
  ]),
  plugin('grpc-kit', 'gRPC kit', 'Commands for protobuf design and service review.', [
    command('proto', 'Design a protobuf service', `Design the proto the user describes.

1. Choose request and response messages with field numbers.
2. Reserve removed fields.
3. Plan compatibility for future changes.`),
    command('grpc-review', 'Review a gRPC service', `Review the service the user names.

1. Check deadlines, retries, and status codes.
2. Verify message compatibility.
3. Flag unbounded payloads.`),
  ]),
  plugin('websocket-kit', 'WebSocket kit', 'Commands for realtime design and reconnection.', [
    command('socket-design', 'Design a realtime channel', `Design the realtime channel the user describes.

1. Define the message types and sequence numbers.
2. Plan authentication at connect time.
3. Define backpressure and message size limits.`),
    command('reconnect', 'Design reconnection', `Design reconnection for the client the user describes.

1. Use exponential backoff with jitter.
2. Resume from the last acknowledged sequence.
3. Handle missed messages and duplicate delivery.`),
  ]),
  plugin('microservices-kit', 'Microservices kit', 'Commands for service boundaries and contracts.', [
    command('service-boundary', 'Evaluate a service boundary', `Evaluate the boundary the user describes.

1. List the data and operations inside it.
2. Check coupling and chatty calls.
3. Recommend split, merge, or keep, with reasons.`),
    command('contract', 'Define a service contract', `Define the contract between the services the user describes.

1. List operations, payloads, and errors.
2. Choose sync or async per operation.
3. Plan versioning and compatibility.`),
  ]),

  plugin('docker-kit', 'Docker kit', 'Commands for Dockerfiles and Compose services.', [
    command('dockerfile', 'Write a Dockerfile', `Write a Dockerfile for the app the user describes.

1. Use a pinned base image and multi-stage build.
2. Order layers for caching.
3. Run as a non-root user and keep secrets out.`),
    command('compose', 'Write a Compose setup', `Write a Compose file for the services the user describes.

1. Define healthchecks and dependencies.
2. Mount data in named volumes.
3. Keep secrets out of the file.`),
  ]),
  plugin('kubernetes-kit', 'Kubernetes kit', 'Commands for manifests and workload review.', [
    command('manifest', 'Write a Kubernetes manifest', `Write the manifest the user describes.

1. Set requests, limits, and probes.
2. Pin image tags and set a restrictive security context.
3. Add labels and annotations.`),
    command('k8s-review', 'Review a workload', `Review the workload the user names.

1. Check probes, resources, and rollout strategy.
2. Verify service accounts and secrets.
3. Flag single points of failure.`),
  ]),
  plugin('ci-kit', 'CI kit', 'Commands for pipeline design and fixing failures.', [
    command('pipeline', 'Design a pipeline', `Design the CI pipeline the user describes.

1. Order steps from cheapest to most expensive.
2. Cache dependencies by lockfile.
3. Gate deploys on tests and a reviewable artifact.`),
    command('ci-fix', 'Diagnose a CI failure', `Diagnose the CI failure the user pastes.

1. Identify the first failing step, not the loudest.
2. Reproduce the command locally.
3. Propose the smallest fix and verify it.`),
  ]),
  plugin('terraform-kit', 'Terraform kit', 'Commands for modules and plan review.', [
    command('module', 'Write a Terraform module', `Write the module the user describes.

1. Define typed inputs with sensible defaults.
2. Expose only useful outputs.
3. Tag resources with owner and purpose.`),
    command('plan-review', 'Review a Terraform plan', `Review the plan the user pastes.

1. Find replacements and deletions first.
2. Check networking, identity, and data changes.
3. Recommend approval or the safer sequence.`),
  ]),
  plugin('linux-kit', 'Linux kit', 'Commands for shell scripts and system diagnosis.', [
    command('shell', 'Write a shell script', `Write the shell script the user describes.

1. Start with set -euo pipefail.
2. Quote variables and validate arguments.
3. Clean up temporaries with trap.`),
    command('diagnose', 'Diagnose a Linux issue', `Diagnose the system issue the user describes.

1. Gather evidence: logs, processes, disk, memory, network.
2. Identify the failing layer before changing anything.
3. Propose a reversible fix.`),
  ]),
  plugin('nginx-kit', 'Nginx kit', 'Commands for proxy configuration and TLS checks.', [
    command('proxy-config', 'Write a proxy config', `Write the nginx config the user describes.

1. Set upstreams, timeouts, and headers.
2. Enable compression and caching where appropriate.
3. Validate with nginx -t.`),
    command('tls-check', 'Check TLS settings', `Review the TLS setup the user describes.

1. Check protocol versions, ciphers, and redirects.
2. Verify HSTS and certificate renewal.
3. Report gaps with severity.`),
  ]),
  plugin('cloud-kit', 'Cloud kit', 'Commands for cloud architecture and cost checks.', [
    command('architecture', 'Design a cloud architecture', `Design the architecture the user describes.

1. Choose managed services with a reason.
2. Draw the network and trust boundaries.
3. List failure modes and their handling.`),
    command('cost-check', 'Find cloud cost savings', `Review the resources the user lists for cost.

1. Find idle and oversized resources.
2. Check storage retention and data transfer.
3. Rank savings by effort.`),
  ]),
  plugin('sre-kit', 'SRE kit', 'Commands for SLOs and runbooks.', [
    command('slo', 'Define an SLO', `Define an SLO for the service the user describes.

1. Choose the user-facing indicator and target.
2. Define the error budget window.
3. State what happens when the budget burns.`),
    command('runbook', 'Write a runbook', `Write a runbook for the operation the user describes.

1. List symptoms and how to confirm them.
2. Give exact commands in order.
3. Include escalation and rollback.`),
  ]),
  plugin('incident-kit', 'Incident kit', 'Commands for incident briefs and postmortems.', [
    command('incident-brief', 'Write an incident brief', `Write a brief for the incident the user describes.

1. State impact, start time, and current status.
2. List what is known and what is being tried.
3. Name the coordinator and next update time.`),
    command('postmortem', 'Write a postmortem', `Write a blameless postmortem for the incident the user describes.

1. Build a timestamped timeline.
2. Separate contributing causes from triggers.
3. Add follow-ups with owners and dates.`),
  ]),
  plugin('release-ops', 'Release ops', 'Commands for rollouts and rollbacks.', [
    command('rollout', 'Plan a rollout', `Plan the rollout for the change the user describes.

1. Define stages and the signal to advance.
2. Set the pause conditions.
3. Name the rollback trigger.`),
    command('rollback', 'Plan a rollback', `Plan the rollback for the release the user describes.

1. List the exact commands or switches.
2. Check data compatibility with the previous version.
3. Define how to verify recovery.`),
  ]),
];
