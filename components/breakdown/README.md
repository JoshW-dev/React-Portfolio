# Scroll breakdowns

A pinned 3D visual on the left (about 60% of the screen, running to its left edge), steps on the right (about 34%); scrolling drives the visual. On phones the visual pins across the top 38% of the screen and the steps scroll under it, fading into it through a soft edge with no rule. Nothing sits under the visual: no caption, no step count. Worked example: `components/orbit/CubeSatBreakdown.tsx` with `cubesatBreakdownScene.ts`.

## Build one

1. Client component: `<ScrollBreakdown label steps={[{ id, title, body }]} visual={(api) => <Visual api={api} />} />`. Two to four sentences per step.
2. `Visual` renders `<BreakdownCanvas api={api} load={async () => { const m = await import("./myScene"); return (T, ctx) => m.createMyScene(T, ctx, overlayRefs) }}>`, with SVG and HTML label overlays as children.
3. The scene module returns `{ frame(dt), resize(), dispose() }`. In `frame`, read `ctx.position.current`: 0 at step 0, 1 at step 1, fractional between. With reduced motion it is whole numbers and `frame(0)` runs only on change, so don't animate between states.
4. Drive values with `track([v0, v1, ...], p)` (holds at each step, eases between) and fade overlays with `near(p, i)`.
5. Page: render it outside the page's `wrap`, so it runs the full width of the screen, as `app/projects/[slug]/page.tsx` does.
6. Pick layouts with `isWideStage(width, height)` from `kit.ts`. The desktop stage is about square, so a plain aspect test can't tell it from a phone.

## kit.ts

- `createRenderer(T, canvas)` transparent, DPR capped at 2; `sizeRenderer` on resize; `disposeRenderer` on unmount.
- `paperLights`, `paperMaterial(T, palette.fills[0])` (flat-shaded Lambert), `inkEdges(T, mesh)` for 1px ink outlines.
- `readPalette(host)` reads the site tokens. Blue (`palette.agent`) only on the part the current step is about.
- `createProjector(T)` projects a 3D point to stage pixels; `placeCallouts(items, modelBox, stage)` puts labels outside the model's box with thin leaders; `createScreenBox(T)` measures that box.
- The loop, pausing off screen or in a hidden tab, and three.js loading are handled by `BreakdownCanvas`.

## Look

White page, pale fills, thin black edges, few words on the canvas. No dark panels, glows, boxed diagrams or all-caps labels. No caption or step numbers under the visual (Josh, 2026-11-18): the space goes to the steps.

Check with `npx tsc --noEmit` and screenshots at 1440x900 and 390x844.
