# ChainForge

> Drop every paper on your niche topic. ChainForge hands you the **only logically valid order** to master it — and rebuilds the curriculum the instant new material lands.

ChainForge is an **offline-first** personal knowledge tool that turns a messy pile of course notes, papers, and documents into a **sequenced, layered learning path**. It runs entirely in your browser (no server, no internet, no account) so you can use it to clear your course doubts on a flight, in a library, or on a weak Wi-Fi hostel connection.

## The core idea

Under the hood, ChainForge models every concept in your material as a node and every "you need X before Y" relationship as a directed edge. The result is a **Directed Acyclic Graph** (DAG) of prerequisites. To produce a study order, ChainForge runs **Kahn's algorithm** on this DAG — the exact BFS + indegree technique required by LeetCode **210. Course Schedule II**.

- If the DAG is consistent, Kahn's algorithm produces a valid topological order in `O(V + E)` — that's your curriculum.
- If the DAG has a cycle, Kahn's algorithm stops early. ChainForge flags the cycle as an **"unresolved contradiction in the field"** and shows you exactly which concepts disagree.

## Why this is useful for course work

When you're stuck in a course, the real problem is usually not that one topic is hard — it's that you're missing a prerequisite three topics back. ChainForge answers the question *"what is the shortest list of things I actually need to review, in order, to unblock me?"* without ever needing the internet.

## Evaluation-aligned roadmap (planned commits)

| # | Commit | Focus |
|---|--------|-------|
| 1 | **Foundation** ✓ | Graph data structure, Kahn's algorithm with BFS layering, cycle detection, browser-based test suite, minimal demo UI |
| 2 | **Interactive canvas + incremental updates** ✓ | SVG canvas, drag-to-add edges, partial BFS re-layering on every edit (`O(V'+E')`), node/edge removal with descendant recomputation, cycle rejection showing the closing path, localStorage persistence |
| 3 | **Document ingestion + concept extraction** ✓ | Paste notes / upload .txt / .md, offline concept extractor, auto-edge suggestion, mastery-path export, contradiction resolver |
| 4 | Polish | Theming, keyboard shortcuts, empty states, export to Markdown study plan, packaged single-file build |

## Complexity guarantees

| Operation | Time | Space |
|-----------|------|-------|
| Topological sort (Kahn's BFS) | `O(V + E)` | `O(V + E)` |
| Layer assignment (same pass) | `O(V + E)` | `O(V)` |
| Cycle detection | `O(V + E)` | `O(V)` |
| Add node | `O(1)` amortized | `O(1)` |
| Add edge (structural) | `O(1)` amortized | `O(1)` |
| Cycle pre-check on edge add | `O(V' + E')` reachable from `v` | `O(V')` |
| Incremental re-layer on edge add | `O(V' + E')` on affected descendants only | `O(V')` |
| Re-layer on edge / node removal | `O(\|D\| + E_D)` on descendant closure of `v` | `O(\|D\|)` |
| Storage save / load | `O(V + E)` serialise / rehydrate | `O(V + E)` |

## Running it

Open `index.html` in any modern browser. That's it. No build step, no install, no network.

```
open index.html           # macOS
xdg-open index.html       # Linux
start index.html          # Windows
```

To run the test suite, open `tests/test.html` in the same way — all tests execute in the browser and print pass/fail to the page.

## Project layout

```
ChainForge/
├── index.html            # offline interactive shell
├── src/
│   ├── Graph.js          # adjacency-list DAG with reverse-edge tracking
│   ├── Kahn.js           # O(V+E) topological sort + BFS layering
│   ├── State.js          # incremental layer maintenance & cycle-pre-check
│   ├── Storage.js        # localStorage persistence (injectable driver)
│   ├── Canvas.js         # SVG renderer + drag-to-edit interactions
│   ├── Extractor.js      # offline concept + prerequisite suggestion engine
│   ├── Exporter.js       # Markdown mastery-path export
│   ├── Resolver.js       # concrete cycle recovery for contradictions
│   └── App.js            # demo wiring
├── tests/
│   ├── test.html         # browser test runner
│   └── tests.js          # 38 cases: LC210 + layering + cycles + incremental
│                         #           + partiality proofs + storage + ingestion
│                         #           + export + resolver
├── styles/
│   └── main.css
└── README.md
```
