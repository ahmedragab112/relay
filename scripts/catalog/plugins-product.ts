import { command, plugin, type PluginSeed } from './types.js';

export const productPlugins: PluginSeed[] = [
  plugin('prd-kit', 'PRD kit', 'Commands for writing and reviewing product requirements.', [
    command('write-prd', 'Write a PRD', `Write the PRD the user describes.

1. State the problem and who has it before any solution.
2. List requirements as testable statements with priorities.
3. Name what is explicitly out of scope.
4. Close with open questions and who answers them.`),
    command('prd-review', 'Review a PRD', `Review the PRD the user provides.

1. Check every requirement can be verified.
2. Find scope that crept in without a decision.
3. Confirm success is measurable.
4. List the questions a builder would get stuck on.`),
  ]),
  plugin('story-kit', 'User story kit', 'Commands for stories and acceptance criteria.', [
    command('write-story', 'Write a user story', `Write the story the user describes.

1. Name the person, their goal, and why it matters.
2. Write acceptance criteria as observable outcomes.
3. Include the empty, error, and permission states.
4. Keep the story small enough to finish in days.`),
    command('split-story', 'Split a large story', `Split the story the user provides.

1. Find the smallest slice that delivers user value.
2. Separate data work from interface work only if both ship.
3. Order slices so early ones can be tested.
4. Say what each slice does not cover.`),
  ]),
  plugin('research-kit', 'Research kit', 'Commands for user research plans and synthesis.', [
    command('interview-plan', 'Plan user interviews', `Plan interviews for the question the user describes.

1. State the decision the research informs.
2. Choose participants who have the problem now.
3. Write open questions, not feature pitches.
4. Plan how findings will be recorded and shared.`),
    command('synthesize', 'Synthesize findings', `Synthesize the findings the user provides.

1. Group observations before drawing conclusions.
2. Separate what people did from what they said.
3. Count how many participants showed each pattern.
4. End with the decision this supports.`),
  ]),
  plugin('roadmap-kit', 'Roadmap kit', 'Commands for sequencing work and communicating plans.', [
    command('sequence', 'Sequence a roadmap', `Sequence the work the user describes.

1. Order by dependency and learning value, not size.
2. Put the riskiest assumption earliest.
3. Budget for the maintenance each launch creates.
4. Mark what can be cut without breaking the story.`),
    command('roadmap-brief', 'Write a roadmap brief', `Write a roadmap brief for the plan the user describes.

1. State the outcome each theme targets.
2. Explain why now for the first item.
3. Show what is not being done and why.
4. Keep confidence levels honest.`),
  ]),
  plugin('metrics-kit', 'Metrics kit', 'Commands for choosing and reviewing product metrics.', [
    command('pick-metric', 'Choose a metric', `Choose metrics for the goal the user describes.

1. Name the user behavior that indicates success.
2. Pick one primary metric and a guardrail.
3. Define the population and the window.
4. List ways the metric can be gamed.`),
    command('metric-review', 'Review a metric', `Review the metric the user provides.

1. Check the numerator and denominator mean what they claim.
2. Look for survivorship and selection bias.
3. Confirm the metric moves for the right reason.
4. Compare against a period that was not special.`),
  ]),
  plugin('experiment-kit', 'Experiment kit', 'Commands for test design and readouts.', [
    command('design-test', 'Design an experiment', `Design the experiment the user describes.

1. State the hypothesis and the single change.
2. Choose the unit and the sample size before starting.
3. Define the stopping rule up front.
4. Pre-commit to the decision each result triggers.`),
    command('readout', 'Write an experiment readout', `Write the readout for the experiment the user describes.

1. Report the primary metric and its interval.
2. Report guardrails before any secondary metric.
3. Separate statistically visible from practically meaningful.
4. State the decision and what happens next.`),
  ]),
  plugin('pricing-kit', 'Pricing kit', 'Commands for packaging and price decisions.', [
    command('package', 'Design packaging', `Design packaging for the product the user describes.

1. Anchor packages on the value metric, not seats by default.
2. Make the upgrade reason obvious inside the product.
3. Check every boundary case of the free tier.
4. Compare against the alternatives customers actually have.`),
    command('pricing-review', 'Review pricing', `Review the pricing the user describes.

1. Check willingness to pay against how the value scales.
2. Find features that should gate and should not.
3. Model revenue at the edges, not just the middle.
4. Say which assumption would invalidate the plan.`),
  ]),
  plugin('feedback-kit', 'Feedback kit', 'Commands for triaging feedback and reviews.', [
    command('triage-feedback', 'Triage user feedback', `Triage the feedback the user provides.

1. Separate bugs, requests, and confusion.
2. Count how often each theme appears.
3. Find the underlying job behind each request.
4. Recommend one fix with the largest reach.`),
    command('review-reply', 'Draft replies to reviews', `Draft replies for the reviews the user provides.

1. Answer the specific complaint, not a template.
2. Say what changed or when it will.
3. Keep it short and sign like a person.
4. Never argue in public.`),
  ]),
  plugin('launch-kit', 'Launch kit', 'Commands for launch plans and checklists.', [
    command('launch-plan', 'Plan a launch', `Plan the launch for the feature the user describes.

1. Define the audience for the first day.
2. List the switches, docs, and support notes to prepare.
3. Plan the rollback before the rollout.
4. Name who watches what in the first hours.`),
    command('launch-review', 'Run a launch review', `Review the launch the user describes.

1. Check telemetry covers the new path.
2. Confirm support has the answers.
3. Verify the rollback still works today.
4. List what would make you pause the rollout.`),
  ]),
  plugin('retro-kit', 'Retro kit', 'Commands for retrospectives and follow-through.', [
    command('run-retro', 'Run a retrospective', `Plan the retrospective for the period the user describes.

1. Ask for facts before feelings.
2. Find one process change worth keeping.
3. Limit actions to what a person can own this week.
4. Follow up on last period's actions first.`),
    command('retro-actions', 'Turn a retro into actions', `Turn the retro notes the user provides into actions.

1. Convert each theme to one owner and a date.
2. Drop actions that need a decision nobody made.
3. Track them in the place work is tracked.
4. Review completion at the next retro.`),
  ]),
  plugin('blog-kit', 'Blog kit', 'Commands for engineering blog posts and essays.', [
    command('outline-post', 'Outline a post', `Outline the post the user describes.

1. Lead with the claim the reader should remember.
2. Give one concrete example before the theory.
3. Cut anything that does not support the claim.
4. Close with what you would do differently.`),
    command('edit-post', 'Edit a draft', `Edit the draft the user provides.

1. Tighten the first paragraph to one idea.
2. Replace abstractions with the specific case.
3. Remove hedges and qualifiers that add nothing.
4. Check every claim has evidence in the post.`),
  ]),
  plugin('docs-kit', 'Docs kit', 'Commands for documentation structure and review.', [
    command('plan-docs', 'Plan documentation', `Plan documentation for the product the user describes.

1. List the tasks a reader must accomplish.
2. One page per task, in the order they hit them.
3. Start each page with the outcome.
4. Note what belongs in reference versus guide.`),
    command('docs-review', 'Review documentation', `Review the documentation the user provides.

1. Check a newcomer can finish the task unaided.
2. Verify every command and path is current.
3. Cut setup steps that no longer matter.
4. Add the error a reader is most likely to hit.`),
  ]),
  plugin('adr-kit', 'ADR kit', 'Commands for architecture decision records.', [
    command('write-adr', 'Write an ADR', `Write the decision record for the choice the user describes.

1. State the context and the forces at play.
2. List the options considered and why they lost.
3. Record the decision in one sentence.
4. Note consequences and when to revisit.`),
    command('adr-review', 'Review an ADR', `Review the decision record the user provides.

1. Check the decision is stated, not implied.
2. Verify rejected options had real reasons.
3. Find consequences that were not considered.
4. Confirm it names a revisit condition.`),
  ]),
  plugin('changelog-kit', 'Changelog kit', 'Commands for release notes and change communication.', [
    command('write-changelog', 'Write a changelog entry', `Write the changelog for the change the user describes.

1. Group by added, changed, fixed, removed.
2. Describe the user-visible effect first.
3. Mention breaking changes at the top.
4. Link the issue for details.`),
    command('changelog-review', 'Review a changelog', `Review the changelog the user provides.

1. Check every entry is understandable without context.
2. Verify breaking changes are labeled.
3. Remove internal refactors readers cannot use.
4. Confirm dates and versions are right.`),
  ]),
  plugin('email-kit', 'Email kit', 'Commands for transactional and product email.', [
    command('write-email', 'Write a product email', `Write the email the user describes.

1. Put the reason for the email in the subject.
2. Lead with what the reader needs to do.
3. One call to action, linked once.
4. Check it reads well on a phone with images off.`),
    command('email-review', 'Review an email sequence', `Review the email sequence the user provides.

1. Check each email stands alone.
2. Confirm the trigger and delay are correct.
3. Verify unsubscribe and preferences work.
4. Remove emails that repeat the same ask.`),
  ]),
  plugin('social-kit', 'Social kit', 'Commands for launch posts and social copy.', [
    command('launch-post', 'Write a launch post', `Write the launch post the user describes.

1. Open with the outcome for the reader.
2. Show the product doing the thing.
3. Keep one link and one ask.
4. Cut adjectives that claim quality without evidence.`),
    command('social-review', 'Review social copy', `Review the social copy the user provides.

1. Check the first line works without context.
2. Verify claims match what shipped.
3. Confirm the tone fits the account.
4. Trim to the platform's comfortable length.`),
  ]),
  plugin('brief-kit', 'Brief kit', 'Commands for design and project briefs.', [
    command('write-brief', 'Write a design brief', `Write the brief for the project the user describes.

1. State the audience and the job the work does.
2. List constraints that are real, with owners.
3. Define what done looks like.
4. Name the decisions the brief leaves open.`),
    command('brief-review', 'Review a brief', `Review the brief the user provides.

1. Check the goal is one goal.
2. Find constraints with no owner.
3. Verify success can be judged by someone else.
4. List what the team will assume if unstated.`),
  ]),
  plugin('style-guide-kit', 'Style guide kit', 'Commands for product voice and writing rules.', [
    command('voice-guide', 'Write a voice guide', `Write the voice guide the user describes.

1. Describe the voice in three concrete adjectives with examples.
2. Show do and do-not pairs for the common cases.
3. Cover errors, empty states, and success messages.
4. Name the words the product avoids.`),
    command('copy-review', 'Review interface copy', `Review the interface copy the user provides.

1. Check every label says what happens on click.
2. Find errors that blame the user or hide the cause.
3. Confirm the same action keeps the same name.
4. Trim words that do no work.`),
  ]),
  plugin('translation-kit', 'Translation kit', 'Commands for localization and translated copy.', [
    command('localize', 'Plan localization', `Plan localization for the product the user describes.

1. Separate translatable copy from layout.
2. List strings with context and screenshots.
3. Plan for text expansion and right-to-left.
4. Decide what stays untranslated and why.`),
    command('translation-review', 'Review translated copy', `Review the translated copy the user provides.

1. Check meaning survives, not word-for-word fidelity.
2. Verify placeholders and markup are intact.
3. Confirm tone matches the source.
4. Look for truncation at the longest strings.`),
  ]),
  plugin('editing-kit', 'Editing kit', 'Commands for tightening prose.', [
    command('tighten', 'Tighten prose', `Tighten the prose the user provides.

1. Cut the throat-clearing before the point.
2. Convert passive constructions where the actor matters.
3. Replace vague nouns with the specific thing.
4. Read the result aloud and cut what stumbles.`),
    command('restructure', 'Restructure a document', `Restructure the document the user provides.

1. Find the one claim each section supports.
2. Reorder so each section earns the next.
3. Move background below the decision.
4. Check headings alone tell the story.`),
  ]),
];
