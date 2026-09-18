# STOP - read this first

Before creating, updating, or documenting anything for this project, read the
authoritative vault manual at `00_System/AI_CONTEXT.md`. Project documentation
belongs in the Second Brain vault, not in this project directory. Follow the
vault's naming, tagging, frontmatter, template, placement, and linking rules.

## Second Brain Quick Reference

| Resource | Path |
| --- | --- |
| Vault root | `/Users/shalinshah/Library/CloudStorage/GoogleDrive-2002shalin@gmail.com/My Drive/Obsi/Second-Brain` |
| Master AI context | `/Users/shalinshah/Library/CloudStorage/GoogleDrive-2002shalin@gmail.com/My Drive/Obsi/Second-Brain/00_System/AI_CONTEXT.md` |
| Project docs | `/Users/shalinshah/Library/CloudStorage/GoogleDrive-2002shalin@gmail.com/My Drive/Obsi/Second-Brain/01_Projects/system/` |
| Templates | `/Users/shalinshah/Library/CloudStorage/GoogleDrive-2002shalin@gmail.com/My Drive/Obsi/Second-Brain/00_System/Templates/` |
| Tags | `/Users/shalinshah/Library/CloudStorage/GoogleDrive-2002shalin@gmail.com/My Drive/Obsi/Second-Brain/00_System/Tags.md` |

## Documentation Workflow

1. **READ** the master `AI_CONTEXT.md` and `Tags.md` in the vault.
2. **READ** the project `README.md` at `01_Projects/system/README.md` when it exists.
3. **FIND** existing project documentation before creating anything new.
4. **CREATE** new project documentation in the vault project folder, using the appropriate template.
5. **UPDATE** `Tasks.md` in the vault when work creates or completes a task.
6. **LINK** related notes with Obsidian `[[wikilinks]]` and verify links remain meaningful.

## Documentation Rule

Everything project-documentation-related goes to the Second Brain vault;
nothing stays in the project folder. Do not create project notes, plans,
design documents, task trackers, or other `.md` documentation files here.
`CLAUDE.md` is the single tracked exception because it supplies these
instructions to agents in every clone.

## Project Context

`system` is a system-design learning project for a Node.js notification
ingestion and processing service. It is intended to build a proper
understanding of system design, API design, horizontal scaling, load balancing,
queue-backed asynchronous processing, caching, and performance testing.

The current implementation exposes an Express API, supports direct MongoDB
persistence and Redis-backed queuing, uses background workers with retries and
a dead-letter queue, and includes k6 load-test scripts for comparing the direct
and queued flows. A load balancer is part of the intended deployment topology
for distributing traffic across stateless API instances; caching layers are
planned next and must be documented with their invalidation, consistency,
failure, and observability behavior before being treated as implemented.

For the full project understanding, read the vault project hub at
`01_Projects/system/README.md`, then follow its links to `Architecture.md`,
`API.md`, `Testing.md`, `Roadmap.md`, `Tasks.md`, and `Notes.md`.