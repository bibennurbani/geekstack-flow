# V1 ships manual cross-tool handoff only; automated handoff is deferred

The author wants to spread implementation work to cheaper executors (Codex, Antigravity) while keeping Claude as the planner. V1 supports this only via **manual handoff** — Claude writes a prompt file under `.tcgstackflow/prompts/{task-id}/` and the user pastes it into the target tool. Automated handoff (Claude shelling out to `codex exec` or similar) is deferred until the manual flow has been used on real tasks and the cost-arithmetic — execution savings minus Claude's review-tax on the resulting diff — has been measured rather than assumed.

## Considered options

- **Manual handoff in V1, automate later** — *chosen*.
- **Build automated `codex exec` runner in V1** — rejected: Antigravity has no CLI today, so automation only covers Codex; experimental Codex flags will keep moving; coordination of parallel executors needs worktree logic that V1 doesn't need yet; and the savings premise is currently theoretical.
- **No cross-tool support at all in V1** — rejected: the prompt-file convention is essentially free to add and unlocks the author's intended workflow immediately.

## Consequences

- Workspace gets a `.tcgstackflow/prompts/` directory and a prompt-file template.
- Task-details schema includes an `executor` field per subtask (`claude | codex | antigravity | human`) but in V1 a non-Claude value only changes which prompt file is generated — nothing is launched automatically.
- The automated-runner seam is the executor field plus the prompt convention. Adding automation later means writing a runner that reads those files and shells out — no schema change.
