# GeekStack Flow — Internals · Speaker Script

**Deck:** `docs/geekstackflow-internals-deck.html` (27 slides · open it and press **N** for the notes drawer)
**Format:** ~32 minutes + ~6 minute live demo
**Audience:** senior engineers, plus a few managers
**Numbers verified:** 2026-08-12, against `v0.4.0` (HEAD is code-identical to the tag)
**qmd figures:** read out of the installed `@tobilu/qmd@2.5.3` and measured on the demo machine — not from the README

---

## How to run this deck

| | |
|---|---|
| Navigate | `←` `→` · `Space` · `PageUp`/`PageDown` · `Home`/`End` · click the stage |
| Speaker notes | **`N`** toggles a drawer with a condensed version of this script |
| Jump to a slide | click any dot in the bottom rail, or edit the `#n` in the URL |
| Print / PDF | `Cmd-P` — each slide becomes a page |

The deck is a single self-contained HTML file. No CDN, no network, no build step — fonts are inlined. It will run from a USB stick on a machine with no internet.

**Timing budget**

| Section | Slides | Target |
|---|---|---|
| Frame | 1–3 | 3 min |
| Part 1 · Memory | 4–9 | 7 min |
| Part 2 · Substrate | 10–13 | 4 min |
| Part 3 · Retrieval | 14–18 | 8 min |
| Part 4 · Orchestration | 19–23 | 7 min |
| Demo | 24 | 6 min |
| Close | 25–26 | 3 min |
| Appendix (optional) | 27 | 1 min |

If you are running long, the cuts in priority order are: **27** (appendix), **23** (isolation/concurrency detail), **17** (freshness owners), **13** (wikilinks). Never cut 8, 16, 18, 20, 22 or 25 — those carry the talk.

---

# Frame

## Slide 1 — Cover · *How an AI workflow remembers, retrieves, and runs*

> Everyone in this room has watched an AI write code. That demo is over — it works, it's impressive for about four minutes, and it isn't interesting anymore.
>
> What I want to talk about is the three unglamorous problems underneath it. Where does the AI's memory of *this project* actually live. How does it find the right piece of that memory when it needs it. And what physically happens when you press a Run button — what gets spawned, what can it touch, and what stops it.
>
> This is a tool called GeekStack Flow. It's a Node CLI that scaffolds a workflow into any repository, and a local browser cockpit that runs the agents. Everything I'm about to show you is plain files on disk. There is no database anywhere in this system, and that turns out to be the decision everything else hangs off.
>
> Every number on this slide was re-verified against the working tree this morning. I'll show you the one place we failed to do that, at the end.

*(~70 seconds. Don't linger on the chips — they're there so people can read them while you talk.)*

---

## Slide 2 — Agenda · *Four questions, one live run*

> Four questions, in order.
>
> One: how does the memory get **written** — because a knowledge base that a human has to maintain is a knowledge base that rots.
>
> Two: why **Markdown, in an Obsidian vault** — and I'll give you the honest version of that argument, including the part where I concede it.
>
> Three: why there's a **second retrieval layer on top of a perfectly good wiki**, and how it actually works internally.
>
> Four: how a browser tab **spawns an agent** — the real argv, the session handling, and why an approval dialog is really a blocked HTTP request.
>
> Then a live run. And then a slide listing everything in this system that is deliberately unfinished, because that's where the actual design reasoning lives.

**For the managers:** *(say this explicitly)*

> If part four gets deep, the one thing to take away is this: when the agent tries to do something risky, it physically stops until a human clicks a button. Not a warning in a log. It stops.

*(~60 seconds)*

---

## Slide 3 — The spine · *One invariant everything else bends to*

> One rule. Plain files are the only store — no parallel database, ever.
>
> That's written down three separate times, in three architecture decision records, and the reason it's written three times is that it keeps being the thing that settles an argument.
>
> Here's the part people misremember, including us. The rule was never *"the UI is read-only."* It was *"there is no second store."* Those are very different, and the difference is why the Cockpit was able to grow from a read-only viewer into something that launches agents and writes files, without breaking anything. It writes the **canonical** task file. It does not maintain a shadow copy of it.
>
> Everything in this talk is a consumer of the same bytes — the agents, your editor, git, the search index, and the browser UI.
>
> And the practical payoff, which I think is genuinely underrated: **a change to what the AI believes about your project arrives as a git diff you can review in a pull request.** There's no "export the knowledge base" problem, because there's nothing to export.

*(~75 seconds. This is the spine — every later decision traces back here.)*

---

# Part 1 · Memory

## Slide 4 — What a wiki page actually is

> Let's start concrete. This is a real page.
>
> Frontmatter, then an H1, then prose, then a block of wikilinks. It looks like documentation ceremony. It isn't — it's a retrieval contract, and I can show you why field by field.
>
> **`summary`.** That's not there for humans. The search index's handling of frontmatter isn't guaranteed, so the rule is that the same sentence is *duplicated* as the body's lead paragraph — because that puts it in the first chunk that gets embedded, where both the keyword index and the vector index will see it. That is a retrieval hack wearing a documentation field's clothes.
>
> **`updated` versus `verified`.** Last edited, versus last confirmed against the actual code. Those are different trust signals and conflating them is how a wiki starts lying to you confidently.
>
> Four of these are checked by code: summary, status, updated, and a kind tag from a closed nine-value vocabulary. Priority, aliases and created are convention only — nothing enforces them.
>
> And one honest note while we're here: `verified` has a *consumer* — the cockpit uses it to compute staleness — and it has **no producer**. Nothing writes it yet. It's discipline, not machinery.

*(~90 seconds. If someone asks "why not just let the LLM write whatever?" — because retrieval quality is a function of structure, and slide 15 shows exactly which structure.)*

---

## Slide 5 — The log is not a changelog — it is an ABI

> Every operation on the wiki appends one entry to a log file, and the heading format is **locked**.
>
> Why locked? Because that shape means `grep`, piped to `tail`, returns the wiki's recent history as a clean timeline — with no Markdown parser anywhere in the loop. Any tool, any language, any agent.
>
> But here's the thing that makes this interesting rather than cute. It stopped being a convention the moment code depended on it. The server splits that file on a regex. And look at the trailing `[^\n]*$` — that's load-bearing. It swallows the rest of the heading line, so page names that appear in the *title* don't get harvested as pages the ingest *touched*. That's the kind of detail you only write after you've been bitten by it.
>
> And staleness falls out of this for free: a page is stale when a *newer* log entry named it, but the page's own date is older than that entry. In other words — an ingest claimed to touch this page and never bumped it. That single rule is the stale-wiki badge you'll see in the demo.
>
> Three things I'd rather say than have you find. Change the prefix and staleness detection silently stops working — nothing throws, the log just quietly becomes unparseable. The documented vocabulary is four operations, but the seeded first entry uses a fifth verb and the audit skill writes a sixth; **nothing validates it**, the parser just filters for the one it cares about. And staleness only covers top-level pages — nested ones never raise the flag.

*(~100 seconds. This is where engineers lean in. The idea to sell: a convention becomes valuable the moment code depends on it, and dangerous for exactly the same reason.)*

---

## Slide 6 — The write path: draft the log *first*

> One role writes the wiki. One. It's called the Ingester, and a single ingest routinely touches ten to fifteen pages.
>
> Its procedure inverts the order you'd expect, and that's the headline of this slide.
>
> **Step two, planning.** Search first, then follow links one hop. Then two rules that do real work. **Append-versus-mint**: only create a new page if the topic is a genuinely distinct concept *and* appending would overflow the host page — otherwise append, and never mint a near-duplicate. And the **coverage map**: take every file the coder actually touched, from the task log, and require that each one resolves either to a wiki page that changed, or to an explicit line saying "no wiki impact, and here's why." A file in neither bucket is an unverified gap. That turns "did we capture everything?" from a feeling into a checklist.
>
> **Step three is the inversion.** Draft the log entry — *the whole entry* — and show it to the user **before touching a single page**.
>
> Think about what that buys. Most systems write the audit record after the fact, which means the audit record can drift from what happened. Here the record **is** the plan. It can't drift, because it's what you approved. If the plan is wrong you edit the draft, not the pages.
>
> **Step four.** Mechanical changes — a moved file, a version bump — apply directly. Semantic ones — changed conclusions, a rewritten section — show you a diff first. And a resolved contradiction has to be written into the **page body**, not just the log; a contradiction resolved only in the log is defined as an *incomplete ingest*. Because the next reader reads the page. They don't read the log.
>
> Three things need a human: a new page, a deletion, a semantic rewrite. Everything else flows. And a rejection is recorded verbatim — "user rejected, and the reason" — so the decision survives.

*(~2 minutes. Slowest slide in part 1. Worth it.)*

---

## Slide 7 — Five ways an ingest starts

> Five triggers, roughly in order of how much human involvement they need.
>
> Manual. Lifecycle — a task reaching a validated state puts it in the queue as ready for the Ingester. Then the chain, which is the one that matters: the automated pipeline runs coder, reviewer, tester, ingester — and it **stops at the ingester**. That's deliberate. It means finishing a task and updating the project's memory are the same event, not two, one of which never happens.
>
> Then the one people find surprising. **A `git pull` becomes a memory event.** A post-merge hook writes a digest into the inbox, so work your *teammates* did also enters memory — not just work this agent did.
>
> And that digest isn't a `git log` dump. It carries its own instructions: capture what changed *into the page bodies*, state the cross-project impact *or explicitly say there isn't any and why*, and write a plain-language summary. Plus it greps the changed-file list for contract-shaped paths — lockfiles, protobufs, openapi specs, migrations, shared packages — so ripple gets flagged rather than guessed at.
>
> That contract is duplicated in three places: the hook, the skill, and the orchestrator's prompt. That's either resilient or redundant depending on how much you trust an agent to read its context. We chose resilient.

*(~80 seconds)*

---

## Slide 8 — The whole loop, on one screen  ⟵ **key diagram**

> Let me put it together, because this is the map for everything in part one.
>
> *(walk left to right, once, unhurried)*
>
> On the left, Raw. Three kinds: things that always exist — the codebase, task files, output from Jira or Snyk or Datadog; things you drop in — PDFs, specs; and the pull digest the git hook writes.
>
> In the middle, the Ingester — plan, draft the log first, apply, and two gates: the human approval gate, and a structural check before re-indexing.
>
> On the right, the store. Pages, the map of content, the append-only log. And underneath it the derived index — gitignored, rebuildable, explicitly **not** a second store.
>
> Now the three things that make this a design rather than a diagram.
>
> **One: Raw is immutable.** It's archived, never deleted. So you can always re-ingest something later with better context. Nothing is destroyed by being understood badly the first time.
>
> **Two: exactly one writer.** Which is what makes an audit trail possible at all — there's one place mutations come from, so there's one place they can be recorded.
>
> **Three: the index at the bottom right is a cache.** Gitignored, regenerable from the files. That's how you get real search without breaking the no-second-store rule.
>
> And along the bottom: the read path, the periodic health checks — which produce a **report, never a rewrite**, so every fix routes back through ingest and hits the same gate — and the cockpit, which computes freshness by reading the log. No extra state anywhere.

*(~2 minutes. Pause after "on one screen" and let people read for three or four seconds before you start talking.)*

---

## Slide 9 — Deterministic vs judgement

> Now the line that I think is the most interesting engineering decision in the whole memory design: **what does code check, and what does an LLM still have to judge.**
>
> On the left, code. One pure function, twenty-two tests. Required frontmatter, filename casing, section size against the chunk target, broken wikilinks, *ambiguous* wikilinks — a slug collision across directories gets surfaced as ambiguous rather than silently resolving to the wrong page — orphans, and reachability from the entry point.
>
> And it has three consumers, one implementation. A `doctor` command you can run. The Ingester's *write-time* gate. And the periodic lint — which is explicitly told to fold those findings in **verbatim**, and I'll quote the instruction: *"do not re-derive them by eye."*
>
> On the right, what stays judgement. Contradictions between pages. Whether a concept deserves its own page. Synonyms. Near-duplicates. Mechanising that half was considered and rejected, with a good line in the decision record: a structure checker guarantees *retrievable structure*; it does not judge meaning. Don't oversell it.
>
> **Why does this exist at all?** Before it was code, nine of ten mechanical checks lived only in prose — and an LLM re-derived them from that document on every single lint. Here's the punchline: our own shipped scaffold had drifted. An off-taxonomy tag and a dangling wikilink, sitting there unnoticed. The spec *was* the enforcement, and the spec drifted.
>
> Now three qualifiers, because someone in this room will read the source.
>
> The chunk "token" count is **characters divided by four**. It's not a tokenizer — that's a deliberate trade to keep the installer dependency-free — and it only warns when the oversized section has no sub-heading to split at. There is exactly **one** fail-level finding in the entire checker: a missing root index. Fifty warnings still exit zero. So step ten's "gate" is a prompt to the agent, not an enforced exit code. And an empty wiki short-circuits to zero findings — which means "clean" and "nothing there" print the same line.

*(~2 minutes. Saying all three qualifiers yourself is the difference between a checker people trust and one you oversold.)*

---

# Part 2 · Substrate

## Slide 10 — "The Karpathy method" — pinned down, not name-dropped

> Part two is short. Why Markdown, and why Obsidian-flavoured Markdown specifically.
>
> The pattern gets called "the Karpathy method," and borrowed terms rot, so this one has its own entry in a section of our language doc literally called **Flagged ambiguities** — because it was being used loosely, and that counts as a defect in the project's own vocabulary.
>
> Pinned down it means five things: a flat directory of atomic pages, Obsidian frontmatter, heavy wikilinks, a map-of-content index as the single entry point, and an append-only log with the greppable prefix we just looked at.
>
> Now — and this is the answer if you're thinking *"that's an appeal to authority"* — we didn't adopt it from a gist. The structure was **reverse-engineered from two wikis the author was already running**, which turned out to be flat Obsidian directories. And the parts of the reference pattern that hadn't survived contact with real use got deleted: the twenty-one pre-created pages, gone, because neither real wiki had them. Three frontmatter fields — confidence, source count, related sources — gone, because nobody ever filled them in.
>
> To be precise, since I'm making a claim about honesty: five anchor pages *do* ship, three of them marked `status: stub`. What we rejected was pre-creating twenty-one *speculative topic* pages — because an empty stub with confident frontmatter actively misleads an AI about what's known.

*(~80 seconds)*

---

## Slide 11 — Three consumers, one store  ⟵ **key diagram**

> Here's the whole substrate argument in one picture.
>
> Three consumers on top. The agents — Claude Code, Codex, Copilot — which are the primary reader *and* the only writer. Obsidian, which is a human lens. And the search index, which is derived.
>
> Underneath, one store: plain Markdown, tracked in git, in your repo.
>
> Note the asymmetry: three consumers, **one** of them writes. And both artifacts at the bottom — the search index and the vault config — are caches. Gitignored, regenerable. That's the whole trick for getting search and a graph UI without violating the rule from slide three.
>
> For the non-engineers, this is the slide that matters: because the store is plain files in the repository, **every change to the AI's understanding of your project shows up as a reviewable diff.** Nobody has to *trust* that the AI learned the right thing. You can read what it wrote, in a pull request, like any other change.

*(~70 seconds)*

---

## Slide 12 — Why *Obsidian*, specifically

> So why Obsidian and not just "Markdown in whatever editor."
>
> The strongest argument is the least obvious one, and it's a **constraint**, not a feature.
>
> Obsidian's file tree hides dotfiles. So the workspace ships **no dotfiles inside it at all**. A weekly folder got renamed to lose its dot. An archive folder got renamed. The gitignore was moved out of the workspace entirely, up to the project root.
>
> Think about that: a UI affordance in a note-taking app drove a filesystem naming convention across the entire tool. That's a real design constraint flowing from a tool choice. It is not decoration.
>
> And the tracked-versus-ignored split encodes a distinction most teams get wrong. Shared **taste** — plugins, hotkeys, themes — is versioned, so a teammate opens the same vault you do. Per-user **window state** — pane layout, graph camera position, cache — is not. Four ignore lines.
>
> Now the counter-argument, which somebody is already forming: *"this is just Markdown files, Obsidian is optional."*
>
> **Correct. And that is the design.** The templates ship no Obsidian directory — the app creates it. Grep the entire cockpit codebase for "obsidian" and you get **nothing**; an earlier decision record promised an "Open in Obsidian" link and it was never built. A team that never installs Obsidian loses the graph view and nothing else.
>
> Which is the strongest form of the argument, not a weakness. **"Obsidian-flavoured" is a format commitment — frontmatter, wikilinks, flat directory — not a tool dependency.** The format is the interop contract. The app is just a viewer.

*(~100 seconds. The concession is the point — deliver it as a win, not an admission.)*

---

## Slide 13 — Wikilinks are load-bearing, not decoration

> Last one in part two, and it sets up part three.
>
> Retrieval here is deliberately **two-stage**. Search supplies *recall* — which of two hundred pages match this phrasing. The wikilink graph supplies *bounded expansion* — what a human author knew was adjacent. Two different jobs.
>
> Drop the graph and you're betting everything on embedding recall. Make it transitive and you blow the token budget the entire design exists to protect. So the rule is **one hop**, and it's stated as a budget: eight results by default, open only the pages you'll actually use, and never read every page "to be safe."
>
> And the graph is mechanically checked — a broken link is reported, and I like the wording, as *"a dead end for one-hop reading."* A basename collision across two directories surfaces as an **ambiguous link** rather than a silent wrong jump. Orphans and unreachable-from-the-index are separate detectors, because connectedness and reachability from the entry point are genuinely different health properties.
>
> One hazard worth naming: renaming a page without adding an alias breaks retrieval and backlinks at the same time. That's why aliases are in the schema.
>
> And one piece of drift I found while preparing this talk: the one-hop rule is in all six agent profiles and in two of the three tool adapters. The Codex adapter mandates search-first but **drops the one-hop clause.** That's a bug, not a design choice — and it's exactly the class of thing our own workspace audit is supposed to catch.

*(~90 seconds. Never claim a protocol is uniform without grepping first — someone will.)*

---

# Part 3 · Retrieval

## Slide 14 — Why a second layer on top of a perfectly good wiki

> So: we have a curated wiki with a hand-maintained index and a link graph. Why add a search engine?
>
> Because a map of content is a **curated tree**, and a curator cannot anticipate every future phrasing.
>
> Here's the example that made it concrete for us. You have a page called "token refresh." Someone asks *"why does the session drop after an hour?"* That page is **invisible** to that question, unless somebody happened to link them. Nobody did, because nobody knew that question was coming.
>
> That's a **recall** failure, and it's structural — it gets strictly worse as the wiki grows, which is to say it gets worse exactly as the wiki gets more valuable.
>
> So: three questions, three answers. The index tells you what exists and how it's organised — curated, always current, zero staleness risk, free. Search tells you which pages match *your* phrasing — statistical, can be stale, costs about two gigabytes of local models. The wikilinks tell you what's adjacent — authored, bounded to one hop.
>
> Replacing the index with search entirely was considered and **explicitly rejected**, and the reason was written down: it discards the curated graph the Ingester maintains, and it makes a sometimes-stale index the only way in. Collapse any two of those rows and you lose something real.

*(~90 seconds. Frame it as recall, not convenience.)*

---

## Slide 15 — How qmd works

> The tool is called **qmd** — Tobi Lütke's. Local hybrid retrieval. SQLite with full-text search and a vector extension, three GGUF models running on your machine through llama.cpp, two point one gigabytes on disk.
>
> **One note before the numbers:** every constant on this slide was read out of the installed package on this laptop — version 2.5.3 — not out of the README. That matters, because two of the README's figures turned out to be wrong, and I'll flag them.
>
> **Stage one is the interesting one, and I nearly missed it. A BM25 probe.** Before anything expensive happens, qmd runs a plain keyword search — and if the top hit is strong enough, it **skips the LLM expansion entirely**. Try the cheap thing first. There's a nice subtlety too: if you pass an explicit `intent:`, that bypass is *disabled* — because the obvious lexical match may not be what you meant. The source comment gives the example: searching "performance" with the intent "web page load times" should not shortcut to a document about sports performance.
>
> **Stage two, expand.** If the probe wasn't confident, a 1.7-billion-parameter model turns your one query into **four**: the original, a lexical variation, a vector variation, and a `hyde:` line — a hypothetical *answer*, which then gets embedded, on the theory that answers sit closer to answers in vector space than questions do.
>
> **Stage three, fuse.** Keyword and vector search per query, then reciprocal rank fusion at k equals sixty. And the original query's two lists get **double weight**; the expansion-derived ones stay at one.
>
> **Stage four, rerank.** Top **forty** candidates — the README says thirty, the constant says forty. And note *what* gets reranked: it picks the best **chunk** per document and scores that. It never reranks full page bodies.
>
> **Stage five, blend.** By the document's RRF rank: top three weight retrieval 75/25, four to ten 60/40, below that 40/60. And the source comment tells you why, which is better than anything I'd have written: *"top retrieval results get more protection from reranker disagreement."*
>
> Agents get three verbs — `query` hybrid, `search` keyword-only, `vsearch` semantic-only — plus a typed query grammar with `lex:`, `vec:`, `hyde:` and `intent:` lines. The discipline is: **switch verbs before you retreat to the index.**
>
> Now the payoff, and this is the part most wiki designs miss entirely. The chunk target is a constant called `CHUNK_SIZE_TOKENS`, and it is **nine hundred**. **That same nine hundred is hardcoded in our own structure checker** — because it is this chunker's target. And stage four reranks the best *chunk*, not the page.
>
> Which means our authoring rules — lead with a prose summary, keep a section under one chunk, surface synonyms in the body — stopped being style advice and became **mechanically checkable invariants**. Purely because we took somebody else's chunker seriously enough to design our writing side around it.

*(~2 minutes. The two README corrections — 40 not 30, and no "15% overlap" — are worth saying out loud: they're a small live demonstration of the observe-don't-assume theme.)*

---

## Slide 16 — What it actually costs to "always lead with search"

> So that's how it works. Here's what it costs — measured on this machine, this morning, against a thirty-eight page wiki.
>
> A cold hybrid query: **thirty-two point seven seconds.** Sixteen of that is the expansion model, fourteen is the reranker.
>
> The same query again, warm: **one point two seconds.** Expansion zero milliseconds, rerank one millisecond — that's the `llm_cache` table you saw in the schema, earning its place.
>
> Pure semantic search: eleven seconds, because the embedding model still has to load.
>
> And plain keyword search: **a hundred and thirty milliseconds.** No model at all.
>
> That's a **two-hundred-and-fifty-fold spread** between the cheapest and the dearest call. And once you have that number, stage one of the previous slide stops looking like a nice optimisation and starts looking like the load-bearing decision in the whole pipeline. Of course it tries BM25 first. BM25 is free.
>
> Two things this changes about what I've been telling you.
>
> One: cold versus warm isn't a caching footnote, it's the **usage model**. A long-lived agent session amortises that model load across many queries. A one-shot CLI call pays it every single time.
>
> Two — and this is the uncomfortable one. I told you earlier that the token saving is unmeasured. It still is. But the **cost** side is now measured, and it isn't small. "Always lead with search" is a real trade, not a free win.
>
> Which brings back the second war story I'm about to tell you. We instruct every agent to lead with the expensive path. We deliberately don't enforce it. And **a discipline that costs thirty seconds on a cold call is exactly the kind of discipline people quietly stop following** — which is precisely the behaviour our telemetry currently cannot detect.

*(~90 seconds. Be scrupulous with the caveat: one laptop, one wiki, cold and warm in separate processes. Directionally solid, not a benchmark. This slide only exists because qmd got installed — say so if it comes up, it's a good look.)*

---

## Slide 17 — Freshness has three owners

> A stale index is a **silent** failure, and silent is the worst kind. An ingest writes fifteen pages, the run dies before it re-indexes, and every reader after that retrieves the old content with no way to know.
>
> So three things re-index, and none of them is redundant — they cover three different write paths.
>
> The **agent** does it as the last step of ingest. That's the portable baseline, and it's the *only* one that works for Codex, or Copilot, or someone in a plain terminal — there's no server to do it for them.
>
> The **orchestrator** does it deterministically after any clean ingester run. That covers the unattended path where nobody's watching.
>
> The **git hook** does it after a merge that touched the wiki. That covers a teammate's PR landing wiki changes outside any task flow entirely.
>
> Remove any one and you reopen a distinct hole.
>
> And the **ordering is the design**. The orchestrator's re-index runs *after* the run record is written, *after* the status hand-off, *after* the next role is queued. So a slow index never delays the pipeline, and a failed index never flips a successful run to failed. But the outcome is **amended onto the run record**, so a failure is visible rather than silent. There is a real window where the pages are new and the index is old — and the mitigation is visibility, not a barrier. That's a deliberate trade.
>
> It's tested with an injected fake — five tests, no real binary, no API cost. Including: a *skipped* index, because the binary isn't installed, still lets the run complete. The throwing case is coded but not tested.

*(~100 seconds)*

---

## Slide 18 — Two war stories  ⟵ **the memorable slide**

> Two stories. These are the two I'd want you to remember.
>
> **First — the global namespace. And I can show you this one live, because it is happening on this laptop right now.**
>
> qmd collection names live in a **machine-global** namespace. We had five projects on one machine. Each one registered a collection called `wiki`. Only the last one indexed owned that name.
>
> That's the config file on the machine I'm presenting from. Both collections — `wiki` and `docs` — point at a *different project*. So any project on this laptop that runs a search scoped to `wiki` gets that project's memory, not its own.
>
> Our own checker is how we found it the first time: **three of five projects had been silently searching a different project's wiki.**
>
> Sit with that. Agents were recalling **another client's memory**. No error. No warning. No signal of any kind. Just confidently, fluently wrong context — which is the worst failure mode an AI system has, because it's indistinguishable from working.
>
> The fix is a project-local index created at setup. And the elegant part: it changed only **setup**, not usage. Collection names stayed constant, so there were **zero edits** to any of the six agent profiles. The rejected alternative — per-project collection names — would have turned a constant into a lookup that every agent has to resolve before it can search anything.
>
> **Second — observe before you enforce.**
>
> Search is mandatory *at setup*. At *query time* it's a discipline, and it is deliberately **not gated**.
>
> Here's what makes that interesting rather than lazy: the enforcement gate was **fully built and unit-tested**, and then shelved. "Deferred" here means evaluated and held pending data — not "we ran out of time."
>
> What shipped instead is telemetry: every run records how it reached the wiki — search, or index fallback — rendered as a badge. And the condition that would justify merging the gate is **written down as a measurable trigger.**
>
> And the postscript, which most talks would leave out. That branch is now **thirty-one commits behind** main. Main has re-implemented the same files underneath it. And the classifier file picked up null bytes, so git treats it as binary — no readable diff, no three-way merge.
>
> **Re-enabling it is a rebase, not a cherry-pick.** That's the real, measurable cost of shelving working code.
>
> Meanwhile the counter that gate would feed has a schema, a serializer, a folding rule, and a UI — and **no producer**. We installed the meter before the valve.

*(~2.5 minutes. Give it room — this is the section people quote afterwards.)*

---

# Part 4 · Orchestration

## Slide 19 — The Cockpit is one process and a projection

> Part four. What actually happens when you press Run.
>
> The Cockpit is a zero-dependency Node HTTP server on localhost, no auth, serving one Vue app. If the bundle isn't built it serves a fifty-line inline fallback UI against the same API — so `npx` works before anyone runs an install.
>
> It has to be local. A hosted backend cannot run your CLI, with your credentials, in your working tree. That's not a deployment preference, it's the shape of the problem.
>
> Everything on screen is a **projection of files**. Read layer, JSON, Vue. Transient run state is injected as an overlay on top — the read layer never even imports the run manager, so the durable and the ephemeral stay layered rather than tangled.
>
> And the punchline is on the right. **The action queue has no store.** It's a filter over active tasks whose status maps to a non-human next role, across a nine-row table. Planned means coder. In-review means reviewer. Validated means ingester.
>
> Every "ready" badge you're about to see in the demo is a **regex over a Markdown `Status:` line.** That's also why a manual status override is a real product feature rather than a debug hatch — it's the same mechanism.
>
> Two honest notes. An unrecognised status **falls through as itself** — it isn't guessed at, it just quietly drops out of the queue, which is the right default. And there is **no cache anywhere**: every request re-walks the registry, every task folder, every run record. That's why the "this will need incremental caching past fifty projects" note exists — written down, not built. Our own design doc claims a cache exists. The code disagrees, and the code wins.

*(~100 seconds)*

---

## Slide 20 — Pressing ▶ Run, exactly

> This is the slide to photograph.
>
> No SDK. It's `child_process.spawn` of the `claude` binary in print mode, with the binary name injectable so the whole path is testable against a fake CLI.
>
> Now read the prompt. *(read it out loud, deadpan)*
>
> *"Adopt the coder role per agents/coder.md and work on ES-6965. Read the task's two files and follow the coder procedure."*
>
> That's it. **No model flag. No system prompt. No skill list. No project path.** The agent's entire personality is a **file path**. All the role separation, the tool ceilings, the procedure — that lives in Markdown the agent is merely *told* to read. And that string is byte-identical to the "Copy prompt" button in the UI, so the manual path and the automated path are provably the same.
>
> Then the governance flags. Eight tokens: a temporary MCP config, a permission-prompt tool, a permission mode, and an allowed-tools list.
>
> **And that allowed-tools list is the single most misread thing in this system.** It is *not* a sandbox. It's the **pre-approved list** — the tools that skip the gate. Everything not on it — edits, writes, shell, other MCP servers — gets routed through the permission tool to a local gate. Governance here is an allow/deny RPC. It is not confinement.
>
> Last point. The runner adapter is **ninety-one lines and pure** — no filesystem, no spawn, no crypto. It only *describes* the invocation and *maps* the stream; the loop owns the spawn, the temp file and the token.
>
> That separation is what makes "adding Codex is a parse-and-argv adapter, not a rewrite" a credible claim rather than an aspiration. It's also why we can unit-test a six-iteration agent loop against a fake CLI replaying a captured stream, with zero API cost.

*(~2 minutes)*

---

## Slide 21 — Creating a session, and continuing it

> Three details here that I think signal real operating experience rather than a design doc.
>
> **First: a "Run" is up to six invocations, not one.** Iteration zero sends the role prompt; one through five send a fixed continue nudge with `--resume`. Let me say the cost out loud before anyone else does — a stubborn task can spend roughly six times a single invocation.
>
> **Second: resume follows the *latest* session id, not the first.** We track both — the first is identity, the latest is what resume uses. Why? Because a resumed print-mode session **can fork a new id**, and resuming the original would silently drop everything in between. If you have ever built a resume loop against a streaming CLI, you have hit this bug. It's commented in the source.
>
> **Third: the hand-off signal is a file read.** After each iteration the loop re-reads the `Status:` line out of the task file. "The agent finished" is defined as *it wrote IN_REVIEW to disk*. That is dogmatic files-as-truth, and it's the reason worktree isolation took a whole design cycle to get right.
>
> Other exits: abort, non-zero exit, single-shot, and **no-progress** — which is literally "the streamed transcript didn't get longer." Honest but imperfect: an agent working silently through tool calls can look idle.
>
> Tokens are summed only from result events, across every iteration, into **one** record — per-message usage is deliberately ignored to avoid double counting, and there's a test that pins this with a 999-token decoy.
>
> And closing the browser tab does nothing. The only disconnect handler removes a stream subscriber. Come back and the whole buffer replays. The inactivity watchdog is re-armed on every chunk and **suspended while an approval is pending** — otherwise "user went to lunch" would kill the run.

*(~2 minutes)*

---

## Slide 22 — The approval modal is a blocked HTTP request  ⟵ **the centrepiece**

> This is the mechanism I most wanted to show you.
>
> The agent calls a tool that isn't on the pre-approved list. Claude Code raises **its own** permission prompt — and we've pointed that prompt at a local MCP server we control.
>
> That server classifies the call against a governance file. Low and medium are allowed instantly — no human, no card. A whole run of edits, test runs and local commits pauses **zero** times.
>
> High or critical, and it makes a **blocking** loopback POST with the idle timeout explicitly set to zero. Our server verifies a per-run token, **holds that socket open**, and pushes a card onto the run's event stream. You see it in the browser. You click. The held response finally returns the decision, the tool call unblocks, and the decision is written into the task log.
>
> **So this is not the Cockpit polling the agent.** It's the agent's own permission prompt, redirected through the Cockpit. The subprocess is genuinely blocked inside a tool call the entire time — which is exactly why the inactivity timer has to be explicitly suspended, or approving something after lunch would kill the run.
>
> Deny isn't fatal, incidentally — it returns "action deferred to human" and the run continues with everything else it can do.
>
> Three properties worth having. A compound command takes the **max** of its segments — a trusted prefix followed by `&& rm -rf` still classifies critical. Project rules can only **raise** a level, never lower it; the trusted list can only lift high to medium, never touch critical. And a critical action without a rollback acknowledgement returns **HTTP 428 — from the route, not from the modal.** The task panel, the global inbox and `curl` all hit the same check. A UI-only guard would be theatre.
>
> One precision point, because this is the credibility test. An unknown tool, or a classifier that throws, **fails safe** — it escalates to high and asks a human. Only an unreachable control channel **fails closed** and auto-denies. Those are different outcomes and most people say "fails closed" about both.
>
> And the hole, before anyone finds it: if that temporary gate config can't be written to disk, the run spawns **ungoverned** — no permission tool, no tool ceiling — and the run record *still* stamps the gate as attached, because that value is a static capability of the adapter, not an observation. That's real. It's narrow. And telling you is worth more than the slide it costs me.

*(~2.5 minutes. The most important slide for the managers — land "it physically stops" clearly.)*

---

## Slide 23 — Isolation, concurrency, and what lands on disk

> Quickly, because this is the "yes, we thought about that" slide.
>
> **Isolation** is per run: in-place, a branch, or a git worktree. Worktree moves the child's working directory into a sibling folder and symlinks the search index in so wiki lookup still works. Both fail **closed** — a dirty tree fails the run rather than quietly working on the wrong branch.
>
> **Concurrency**: the lock is an in-memory map keyed on the project path. **No lockfile.** One main-lane run per project, plus up to three parallel worktree runs. Which means, plainly: two Cockpits on one repo have no mutual exclusion at all. Known, written down.
>
> **Crash**: a placeholder record is written at launch as the tripwire, and orphans get reconciled to aborted on next boot — deliberately only *after* the port bind succeeds, so a second instance that loses the race can't mark the first instance's live runs dead. One caveat: shutdown only reaps the main lane, so Ctrl-C with parallel runs in flight orphans those children.
>
> **The chain** walks planner through ingester. A backward move is a **bounce**, and the default tolerance is one — so one bounce is allowed, and it halts on the second. And I like what the halt does: it writes a durable log entry reclassifying it as a **planning defect** — "a task that keeps bouncing usually has an acceptance criterion that's ambiguous or untestable." Which is almost always true. Every chained launch also re-checks the budget.
>
> And per run you get one record: role, tool, gate, session id, four classes of token count, timestamps, the git baseline for the diff, isolation details, and the raw transcript. **The agent writes its own task-log entries.** The server writes only structural ones.

*(~90 seconds — keep it brisk)*

---

# Demo

## Slide 24 — Demo (~6 minutes)

**Before you start:** have the Cockpit already running, a project with at least one `PLANNED` task, and a finished run with a session report available. Do not `init` live.

> Let me show you the actual thing.

1. **Action queue.** *"N tasks ready" — grouped by the role that comes next.* Say it out loud: this is a status field mapped to a role, nothing more.
2. **Launch.** Open a task, set isolation to worktree, tick the chain toggle, press **Run coder**.
3. **Live stream.** Branch badge appears, text streams in, four token chips tick. → **Close the browser tab. Wait. Reopen it.** *"The run never stopped — the server owns it, not the UI, and the event buffer replays."* This is the beat that makes slide 20 concrete.
4. **Approval.** When a high-risk action fires, the card appears and the agent is stopped. Show the critical path refusing to be one-clicked without a rollback acknowledgement.
5. **Evidence.** Run record → the per-run diff since the git baseline → the transcript, with a session id you can resume by hand from a terminal.
6. **Where the tokens went.** The session report: a real per-turn trace parsed from the agent's own session log, a cost waterfall, tool calls by type. *"And when that log isn't on this machine, it degrades to totals and says so. It never fabricates the trace."*

**Hard rule:** if anything hangs for more than ~15 seconds, go to `docs/images/cockpit.jpg`, narrate what would have happened, and move on. Never debug live — the two closing slides are more valuable than the demo.

---

# Close

## Slide 25 — Not enforced, and not measured

> I want to finish with the slide that earns everything else in this talk.
>
> The posture of this project is *observe before you enforce, and earn every piece of complexity you add*. So here is everything I've told you that is weaker than it sounded.
>
> **Single writer is prose, not enforcement.** The permission gate is *action*-scoped, never *actor*-scoped. Edits are medium risk, and medium auto-allows — so a Reviewer *can* rewrite the code it's reviewing. Separation of duties is the organising idea of this entire workspace, and it is the one invariant the enforcement layer never checks. What shipped instead is a counter, whose trigger to act is a **single occurrence**, because there's no benign explanation for a read-only role writing code. And even that badge can't render, because the parser never surfaces the field the serializer writes.
>
> **Search-first is unenforced at query time by design** — and worse, the telemetry that justifies deferring the gate is monotone, so it can't distinguish "led with search" from "grepped first, then searched." Which is precisely the behaviour the gate targets.
>
> **The token saving is still unmeasured.** The skill says so in its own text — *"discipline, not a proven saving."* We count search calls versus direct reads, not tokens. The real justification is recall, and recall is also unmeasured. What we *have* now measured is the price: thirty-two seconds cold, one point two warm. **We measured the cost of the discipline before we measured its benefit** — which is the wrong order, and worth admitting.
>
> **The structure gate can't fail on quality.** One fail-level finding in the whole checker.
>
> **Only one runner is registered.** The per-role tool map is real; any other value returns a 501 at the door. The cost-spreading knob exists. The behaviour behind it doesn't, yet.
>
> **And no auth, loopback only** — a documented single-local-user threat model, not an oversight. It's the reason a hosted version would be a different product, not a deployment option.
>
> I'm telling you all of this because a talk that hid it would be arguing against its own design.

*(~2 minutes. Deliver as thesis, not apology. Do not rush.)*

---

## Slide 26 — Close

> So. One store. Two retrieval layers. Zero databases.
>
> **Memory is a git-diffable artifact** — every change to what the AI believes about your project arrives as a reviewable diff. There's no export problem because there's nothing to export.
>
> **Retrieval is two-stage on purpose** — statistical recall finds the candidates, an authored graph bounds the expansion to one hop.
>
> **An agent is a subprocess** with a Markdown file for a personality and a blocked HTTP request for a conscience.
>
> **And everything unfinished is written down** — with the condition that would finish it.
>
> The ask is small and it's provable. Take one real task all the way through — plan, code, review, test, ingest — and then read the diff to the wiki. That single loop exercises every mechanism in this talk, and it's the shortest path to believing the compounding-memory claim, because you can read exactly what got learned.
>
> Two commands. Questions?

*(~75 seconds)*

---

## Slide 27 — Appendix (optional) — *The lesson we hadn't applied to ourselves*

**Use with engineers. Skip with clients, or if you're over time.**

> One more, if there's time, because it's the honest bookend to slide nine.
>
> This project ships a test asserting that its own scaffold wiki passes its own checker. It ships another asserting the packaged UI bundle is never stale. It is genuinely serious about mechanising its own conventions.
>
> **Nothing asserts that our own slides match our own code.** No test, no CI job, nothing.
>
> The previous version of this deck froze on the 28th of July. It got excluded from *both* documentation refreshes that came after — including the one whose commit message was literally *"drifted metrics."* Its hero number, rendered at a hundred and eighty pixels, says two hundred and thirty-six tests. The real number is three hundred and fifteen. It also claims a test runner that has never been a dependency of this project.
>
> Every figure in *this* deck was re-verified by hand this morning — which is **exactly the fragile process I criticised on slide nine.** So the fix is the one we already applied to the wiki: **generate or assert the numbers. Don't type them.**
>
> And for completeness — these are *released* numbers. HEAD is code-identical to the v0.4.0 tag; the six commits since are docs and dependency bumps. This is what you get from npm, not a working-tree snapshot.

*(~60 seconds)*

---

# Q&A — the questions you should expect

**"Isn't this just a folder of Markdown files with extra steps?"**
> Yes, and that's the feature. The interesting part isn't the storage, it's the write discipline: one writer, a log entry drafted before any change, an approval gate on new pages and deletions, and a structure checker that runs at write time. Take those away and you have a folder of Markdown that rots. Keep them and you have an auditable memory.

**"How do you know the agents actually follow the retrieval protocol?"**
> Today, we don't enforce it — we record it. Every run stamps how it reached the wiki. The gate that would enforce it is built and shelved with a written trigger condition. And I'll give you the sharp version: the current telemetry can't distinguish "led with search" from "grepped first, then searched," which is the exact behaviour the gate targets. That's a gap in the observability, not just in the enforcement.

**"Six invocations per run — what does that cost?"**
> Worst case roughly six times a single invocation, and most runs exit well before the cap because the loop stops the moment the agent writes its hand-off status. There's a per-run token record, a per-task rollup, and a monthly budget that's re-checked at launch — including for chained runs, which closes the gap where a queued run launches after the money's gone. Actual dollar figures come from parsing the agent's own session log, and when that log isn't present the report degrades to totals rather than guessing.

**"What stops the agent approving its own risky action?"**
> Structurally, nothing on the network layer — the control plane is unauthenticated on loopback; only the three callbacks the child makes are token-checked. The threat model is explicitly "one user, one laptop." What does hold: the classifier is monotone — project rules can only raise a level, the trusted list can only lift high to medium, and a compound command takes the maximum of its segments — plus critical actions are refused at the route without an explicit rollback acknowledgement. If this ever became multi-tenant, that's the first thing to rebuild.

**"Thirty seconds per search? That's unusable."**
> Cold, on a one-shot CLI call, yes — and that's the honest number. Warm it's about a second, because the LLM cache absorbs the expansion and rerank, and an agent session issuing several searches pays the model load once. The bigger point is that qmd's own first stage exists for exactly this reason: it tries keyword search at a hundred and thirty milliseconds and only escalates to the expensive path when the cheap one isn't confident. If it were consistently thirty seconds, the discipline would be indefensible — and we'd know, because it's now measured.

**"Why not use a vector database / RAG framework?"**
> We do use a vector index — it's just a local SQLite file that's gitignored and rebuildable, sitting on top of the files rather than replacing them. The moment the index becomes the source of truth you inherit the migration problem, the backup problem, and the "what does it actually contain?" problem. Keeping it derived means we can delete it and rebuild it, and the wiki is still readable by a human, a diff tool and three different AI CLIs.

**"Does this work with anything other than Claude?"**
> The *workflow* does — the commands and skills are portable Markdown, and Codex and Copilot dispatch the same procedures. The *orchestration* doesn't yet: only one runner adapter is registered and anything else is refused with a 501 at the launch door. The seam exists and is unit-tested against a fake adapter, so adding one is parse-plus-argv rather than a rewrite. But I'd rather say "not yet" than demo a fake.

**"What happens when two people work on the same repo?"**
> Honestly: the workspace is designed for it — everything is files in git, so the wiki and tasks merge like any other change — but the *orchestrator* is single-machine. The lock is an in-memory map in one server process, so two Cockpits on one repo have no mutual exclusion. That's the next real piece of work, and it's why the scope ladder is personal → team → open-source rather than starting at team.

**"What would you do differently?"**
> Two things. I'd have mechanised the wiki structure checks earlier — nine of ten checks lived in prose while the prose itself drifted. And I wouldn't have shelved a finished branch; it's now thirty-one commits behind with a binary-encoded file in it, and re-enabling it is a rebase. The lesson isn't "don't defer" — deferring was right. It's "if you defer, land the inert code on main behind a flag instead of parking it on a branch."

---

# Pre-flight checklist

- [ ] Deck opens and renders — check on the **actual projector resolution** (every slide is verified to fit at 1280×720 and above)
- [ ] `N` opens the notes drawer
- [ ] Cockpit running, browser tab open on Home, at least one `PLANNED` task
- [ ] One completed run with a session report available (for demo beat 6)
- [ ] `docs/images/cockpit.jpg` open in a background tab as the demo fallback
- [ ] Terminal ready with `geekstackflow --version` (proves 0.4.0 if challenged)
- [ ] `qmd --version` → 2.5.3, and **run one hybrid query before you go on stage** so the models are warm — otherwise a live search costs 30 s
- [ ] Decide whether slide 18's redacted config path stays redacted or shows the real project name
- [ ] Know your three cut slides (27, 23, 17) in case you're running long
