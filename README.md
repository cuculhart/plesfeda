# Plesfeda

A board for building **real Work Breakdown Structures** — breakdown first, schedule later.

Most so-called "WBS tools" are actually Gantt chart editors. Plesfeda focuses on what a
WBS actually is: decomposing work into a structure. The protagonists are **breakdown**
and **hierarchy** — dependencies, scheduling, and the Gantt chart are all derived
output, never the input surface.

**Plesfeda is not a project management tool.** It is a tool for calmly judging whether
a given volume of work can fit inside a deadline: break the work down, put effort on
the leaves, and let the structure answer with its cost and earliest finish.

This exists because heavyweight PM tools kept failing the author — MS Project,
OpenProj / LibrePlan and friends let you move rows, but never let you pick up a
block of work and hang it somewhere else in the structure, and their calendars
don't even ship with Japanese holidays — so estimates always ended up back in
Excel. Plesfeda is built to scratch exactly those itches: reparent a whole subtree
by dragging, set your own holidays and working hours, and keep everything local in
plain JSON.

日本語版: [readme.jp.md](readme.jp.md)

## Concept

An infinite canvas where you place **nodes** and connect them into trees.

- **Task node** — one WBS element (work package / activity). Displays a name and a
  required-effort number together.
- **Connect lines** — parent→child breakdown relations. The set of nodes and lines
  renders as a forest on the board.
- **Gantt is output only** — a read-only report generated from the tree. All input
  happens on the tree.

## Breakdown input

The core of the tool: continuous input that mirrors the act of decomposing.

1. Create a `[task]` on the board.
2. Choose **breakdown** in its properties → two dotted-outline `[child]` slots appear:
   - Slot 1 — **active input**, cursor ready.
   - Slot 2 — a **ghost**: a placeholder for the next entry.
3. Confirm slot 1 → slot 2 becomes active and a new ghost appears after it.
4. Walk away mid-entry and the active slot falls back to a ghost that stays at the
   parent's tail. Come back, activate it, and the active+ghost pair resumes.

Ghosts never persist into data — they materialize only when confirmed.

## Structure rules

- **Depth aligns.** Nodes at the same level share the same vertical position,
  regardless of parent.
- **Multiple roots.** The board is a forest. You can also add a new parent later and
  adopt existing roots as its children (bottom-up structuring).
- **Reparent freely.** Move a subtree under a sibling, or under a former descendant —
  the whole branch follows. Cycles are strictly rejected.
- **Deleting a parent offers a choice:** promote its children to roots, or delete the
  whole subtree.
- Branching factor is a variable (`MAX_CHILDREN`), not a methodology limit.
- **WBS numbers are derived.** Every node shows `1.2.3`-style numbering computed from
  its position — reparenting and reordering renumber automatically. Nothing is stored.

## Required effort

- Each task carries an effort number. Zero is hidden; click the number area to type.
- **Rollup:** leaf nodes are entered by hand; a node with children shows the recursive
  sum of its subtree. The root therefore shows the total effort of the structure.

## Dependencies & schedule (PERT/CPM)

- A task can declare predecessor tasks (finish-to-start). Select a task, press
  **Depends on**, then click its predecessors.
- Parent completion means all descendants are done, so depending on a parent waits
  for its whole subtree.
- Leaf earliest start = max(parent start, predecessor finishes); earliest finish =
  start + effort. A parent's duration is the earliest finish of its subtree, so
  independent children run in parallel while dependent siblings serialize.
- Parent nodes show both numbers: **total effort (Σ) and earliest-finish duration**.
- The toolbar shows the project's earliest completion, and the **critical path** is
  highlighted on nodes and dependency edges.
- Dependency cycles and ancestor/descendant dependencies are flagged as errors; the
  Gantt report stays locked until they are resolved.

## Gantt output

A read-only report rendered from the schedule — simple calendar, baseline date,
weekend/holiday exclusion, CP highlighting, milestones, and print-friendly
two-dimensional pagination with per-page headers and page numbers.

## i18n

English-first. UI strings are written in English in the source, and each locale is a
plain translation table keyed by the English source string (see `src/i18n.ts`).
Untranslated strings fall back to English, so adding a language is just extending a
table.

## Tech stack

React + TypeScript + Vite + [@xyflow/react](https://github.com/xyflow/xyflow).
All-local: browser storage plus JSON file export/import. Nothing is uploaded.

```bash
npm install
npm run dev
npm run build
```

## Name

**Plesfeda** = Welsh *pleth* ("weave / braid") + Old Irish *feda* ("woods" — also the
name of the letters of Ogham, the lost Celtic script whose characters are named after
trees). A structure woven from trees.

## License

MIT
