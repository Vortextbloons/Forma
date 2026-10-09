# Sessions

Rig sessions are the working contexts of your agent:

- `rig chat` starts a session when you send the first prompt.
- `/new` starts a fresh session; `/sessions` lists them; `/resume <id>`
  picks one back up.
- Sessions persist as JSONL files under `.rig/sessions/` (config:
  `sessions.persistence: "local"`). A resumed session keeps its history.

Each session runs concurrently with the others — a waiting question in one
session never blocks another. Sessions created with `parentSessionId` branch
from an existing session.

See `rig docs sessions` for the full documentation.
