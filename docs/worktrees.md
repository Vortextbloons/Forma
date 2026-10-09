# Worktrees

With `workspace: "git-worktree"` (or the automatic default in git repos),
each session gets an isolated `git worktree` under `.rig/worktrees/<session>`:

- edits in one session never touch another session's files
- `rig inspect` lists worktrees and their dirty state
- branches are named `rig/<session-id>`; merge/apply/discard are managed by
  the runtime's workspace layer

Requires git >= 2.5 and an initialized repository at the project root
(`git init` if needed).

See `rig docs worktrees` for the full documentation.
