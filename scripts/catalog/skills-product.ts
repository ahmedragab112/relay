import { skill, type SkillSeed } from './types.js';

export const productSkills: SkillSeed[] = [
  skill('prd-writing', 'PRD writing', 'Product & writing', 'Describe the problem before the solution', `A PRD exists to align decisions, not to specify every pixel.

- State the problem, who has it, and how you know.
- List goals, non-goals, and constraints.
- Describe the primary flow and the states around it.
- Define what success looks like with measurable signals.
- Call out open questions and who owns each answer.`),
  skill('technical-writing', 'Technical writing', 'Product & writing', 'Write so a reader can act', `Lead with what the reader needs to do or know.

- Put the outcome first, then the steps.
- Use the same term for the same thing throughout.
- Prefer short sentences and active voice.
- Include a working example for anything procedural.
- Cut anything that does not help the reader act.`),
  skill('api-documentation', 'API documentation', 'Product & writing', 'Docs developers can trust', `Document the contract, not the implementation.

- Show authentication, a first request, and a realistic response.
- List every parameter with type, requiredness, and default.
- Include error codes and what to do about each.
- Keep examples runnable and current.
- Note rate limits, pagination, and versioning.`),
  skill('changelog', 'Changelog', 'Product & writing', 'Release notes people read', `Write for the person using the product, not the person who wrote the diff.

- Group by Added, Changed, Fixed, Removed.
- Describe user-visible effects, not internal commits.
- Mention breaking changes first.
- Link to migration steps where needed.
- Keep entries short and consistent in tense.`),
  skill('architecture-decisions', 'Architecture decisions', 'Product & writing', 'Record the why behind structural choices', `Write an ADR when a decision will be expensive to reverse.

- State the context and the forces at play.
- List the options considered with trade-offs.
- Record the decision and its consequences, including what gets harder.
- Note the date, status, and owners.
- Supersede rather than rewrite old decisions.`),
  skill('user-stories', 'User stories', 'Product & writing', 'Stories that fit a real need', `Describe the user, the situation, and the outcome they want.

- Keep the story about one meaningful outcome.
- Write acceptance criteria that can be tested.
- Include what happens on failure and with empty data.
- Split stories that cannot ship independently.
- Link to designs and open questions.`),
  skill('ux-copy', 'UX copy', 'Product & writing', 'Interface words that guide action', `Say what happens, then what to do next.

- Use the same verb through the whole flow.
- Name controls by the outcome, not the mechanism.
- Errors explain what went wrong and how to fix it.
- Empty states invite the next action.
- Keep tone consistent and calm under failure.`),
  skill('meeting-notes', 'Meeting notes', 'Product & writing', 'Notes that create follow-through', `Capture decisions and owners, not a transcript.

- List attendees, purpose, and date.
- Record decisions in one line each.
- List action items with an owner and due date.
- Note unresolved questions and who will answer them.
- Send notes within the same day.`),
  skill('research-brief', 'Research brief', 'Product & writing', 'Turn questions into a plan', `Define what you need to learn before deciding how to learn it.

- State the decision the research informs.
- Write the questions you need answered.
- Choose the method that fits the question and timeline.
- Define who you will talk to and why.
- Summarize findings as implications, not a data dump.`),
  skill('presentation', 'Presentation', 'Product & writing', 'Slides that make one point', `Every deck has a thesis; everything else supports it.

- Open with the decision or insight, not the agenda.
- One idea per slide, in the title when possible.
- Use visuals that show the point, not decorate it.
- Reduce text to what you will say.
- End with the ask and the next step.`),

  skill('data-analysis', 'Data analysis', 'Data & AI', 'Answer a question with data you can defend', `Start from the decision, then find the data that supports it.

- Define the metric and its denominator before querying.
- Check completeness, duplicates, and date ranges.
- Separate correlation from causation in your wording.
- Show the uncertainty and the sample size.
- State assumptions and what would change the conclusion.`),
  skill('pandas', 'Pandas', 'Data & AI', 'Readable, reliable dataframes', `Keep transformations explicit and reproducible.

- Inspect dtypes and null counts after loading.
- Avoid chained assignment; use .loc.
- Prefer vectorized operations over row loops.
- Name intermediate frames for the question they answer.
- Save the cleaned dataset and the script that produced it.`),
  skill('analytics-sql', 'Analytics SQL', 'Data & AI', 'Queries that answer business questions', `Write the question above the query.

- Filter to the relevant cohort and window first.
- Join on keys you have verified are unique.
- Handle time zones explicitly.
- Use CTEs named after the step they perform.
- Include a sanity check row count before trusting the result.`),
  skill('data-visualization', 'Data visualization', 'Data & AI', 'Charts that show the finding', `Choose the chart from the question, not from the available options.

- Start the value axis at zero for bars.
- Label axes with units.
- Highlight the one series that answers the question.
- Avoid dual axes and 3D effects.
- Write the takeaway in the chart title or caption.`),
  skill('prompt-engineering', 'Prompt engineering', 'Data & AI', 'Prompts that produce reliable work', `Describe the task, the context, and the shape of the answer.

- State the role and the goal in one sentence each.
- Include examples for anything with a specific format.
- Ask for assumptions and uncertainty explicitly.
- Keep instructions ordered and non-contradictory.
- Iterate from real failure cases, not imagined ones.`),
  skill('retrieval-augmented-generation', 'Retrieval-augmented generation', 'Data & AI', 'Ground answers in retrieved sources', `Retrieval is a precision problem before it is a prompting problem.

- Chunk documents by meaning and keep headings with content.
- Embed and retrieve with the same model family.
- Rerank before filling the context window.
- Require citations and refuse when sources do not support the answer.
- Evaluate retrieval recall separately from answer quality.`),
  skill('llm-evals', 'LLM evals', 'Data & AI', 'Measure model behavior on purpose', `Write the eval before changing the prompt.

- Build a small set of real inputs with expected properties.
- Score with deterministic checks where possible.
- Use pairwise comparison for subjective quality.
- Track regressions per change, not only the average.
- Keep a held-out set you do not tune against.`),
  skill('model-fine-tuning', 'Model fine-tuning', 'Data & AI', 'Fine-tune only after prompting fails', `Prove the baseline first, then improve it.

- Collect examples that match the real distribution.
- Clean and deduplicate before training.
- Hold out a validation set from the same distribution.
- Compare against the best prompted baseline.
- Record data, hyperparameters, and eval results together.`),
  skill('ml-experiments', 'ML experiments', 'Data & AI', 'Experiments you can reproduce', `One question, one change, one recorded result.

- Fix seeds and record environment versions.
- Keep a baseline that never changes.
- Log metrics, config, and artifacts together.
- Compare across multiple runs before concluding.
- Write down the next experiment before running it.`),
  skill('notebooks', 'Notebooks', 'Data & AI', 'Notebooks that survive handoff', `A notebook should run top to bottom on a clean kernel.

- Load data once in a clearly marked cell.
- Avoid hidden state from deleted cells.
- Name steps with markdown headings.
- Move reusable logic into modules.
- Clear outputs and pin dependencies before sharing.`),
];
