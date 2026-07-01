# Graph Report - React-Portfolio  (2026-06-03)

## Corpus Check
- 27 files · ~539,040 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 96 nodes · 97 edges · 13 communities (10 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9a5f9b56`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]

## God Nodes (most connected - your core abstractions)
1. `scripts` - 5 edges
2. `browserslist` - 3 edges
3. `engines` - 2 edges
4. `eslintConfig` - 2 edges
5. `hooks` - 2 edges
6. `permissions` - 2 edges
7. `ClaudeIcon()` - 2 edges
8. `N8nIcon()` - 2 edges
9. `MakeIcon()` - 2 edges
10. `McpIcon()` - 2 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (13 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.11
Nodes (19): dependencies, axios, bootstrap, react, react-bootstrap, react-dom, react-github-calendar, react-icons (+11 more)

### Community 2 - "Community 2"
Cohesion: 0.18
Nodes (10): browserslist, development, production, engines, node, eslintConfig, extends, name (+2 more)

### Community 4 - "Community 4"
Cohesion: 0.25
Nodes (7): background_color, display, icons, name, short_name, start_url, theme_color

### Community 11 - "Community 11"
Cohesion: 0.43
Nodes (5): ApifyIcon(), ClaudeIcon(), MakeIcon(), McpIcon(), N8nIcon()

### Community 12 - "Community 12"
Cohesion: 0.40
Nodes (5): scripts, build, eject, start, test

## Knowledge Gaps
- **39 isolated node(s):** `name`, `version`, `private`, `node`, `@react-pdf/renderer` (+34 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `Community 0` to `Community 2`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Why does `scripts` connect `Community 12` to `Community 2`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _39 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._