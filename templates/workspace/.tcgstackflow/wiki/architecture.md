---
title: System Architecture
summary: The high-level system design — the major components, how code is laid out, and how a request flows through the system.
tags: [architecture]
aliases: [system-design, high-level-architecture, arch]
priority: P0
created: 2026-05-30
updated: 2026-05-30
status: stub
---

# System Architecture

The system's structural spine: the boxes-and-arrows diagram, where each component's code lives, the shape of the data model, the canonical request lifecycle, and the external services the system talks to. Deep topics link out to their own pages rather than bloating this one.

> **Stub.** Filled in by the Ingester from the first scan-and-document task or from a dropped architecture doc in `raw/`.

## High-level diagram

_(ASCII or Mermaid — the boxes and arrows that matter most. Don't try to capture everything — capture the spine.)_

## Component map

_(Where does code live? Top-level directories with one-line purpose for each.)_

## Data model summary

_(Pointer to `wiki/data-model.md` when it exists, or summarise inline if small.)_

## Request flow

_(Pointer to `wiki/request-flow.md` when it exists, or sketch the canonical request lifecycle inline.)_

## External services

_(Each external integration gets its own page — e.g. `[[strava-integration]]`. List them here.)_

## Related pages

- [[project-overview]]
- [[domain]]
