# Scope: personal-first, team-usable next, OSS-ready architecture

This project is built primarily for one user (the author), with the immediate next gate being usability by the author's team at The Creative Geeks. Public OSS distribution is a possible future, not a V1 constraint. V1 is therefore allowed to skip the npm-package CLI scaffolding, four-tool portability matrix, and stack-agnostic detection that a true OSS framing would require — but architectural decisions should not paint us into corners that would block an OSS release later.

## Considered options

- **A. Pure personal tool** — rejected: team usage is explicitly planned soon, so the install/usage flow needs to work for non-authors.
- **B. Personal-first → team-internal → OSS** — *chosen*.
- **C. Full OSS from day one** — rejected: at a user base of 1–5, packaging/CI/support cost outweighs benefit, and we don't yet know which parts of the workflow will hold up under reuse.

## Consequences

- No `npx geekstackflow@latest init .` in V1. Install is template-copy or `git clone` based until reuse proves the CLI worth building.
- No public package name, branding, or four-tool portability matrix until at least one teammate is using it on a real project.
- Internals stay structured enough that a CLI wrapper could be added later without rewriting the workflow itself.
