# Todo SSR benchmark contract

This folder is the authoritative, framework-neutral contract for the todo SSR
benchmark used by every maintained renderer and browser-outcome adapter.

## Required usage

Framework apps must:

1. Import a state from `state.mjs`. `TODO_STATE_VARIANTS` contains exactly 32
   deeply frozen snapshots, and every snapshot contains exactly 100 todos.
2. Preserve the 12 source-level boundaries in `COMPONENTS`. A framework may use
   its normal component syntax, but it may not merge, split, rename, or add
   benchmark component boundaries.
3. Render the classes and `data-*` attributes described by `SELECTORS`,
   `BRANCHES`, and `INTERACTIONS`. Load `styles.css` unchanged.
4. Evaluate all 12 branches from their precomputed boolean fields. Do not
   derive priority, due state, assignment, tag presence, subtask presence, or
   selection during rendering.
5. Render the `todo-loop`, then the nested `tag-loop` inside each todo. Render a
   `.todo-tag-list` for every todo, including todos with no tags.
6. Preserve todo and tag IDs. The required todo sentinels are `todo-0001`,
   `todo-0050`, and `todo-0100`.
7. Implement the four interactions exactly as specified in each framework's
   authored production source: filter, select, toggle completion, and clear
   completed. Astro uses its native authored client-script model because Astro
   does not ship a reactive browser runtime; runner- or wrapper-injected DOM
   mutation shims do not satisfy the contract.
8. Preserve each globally unique timestamped todo title. Timestamps are
   captured from the current UTC clock inside every request so cached final HTML
   cannot satisfy the contract.

The frozen snapshots are SSR inputs. Interactive apps must make a framework-
appropriate copy before changing client state; they must not mutate or replace
the shared snapshots.

## Files

- `contract.mjs` defines component boundaries, fields, branches, loops,
  selectors, text, sentinels, and interactions.
- `state.mjs` provides deterministic, timestamped portable JavaScript state. It has no
  Node-specific imports and can be loaded by Node, Bun, Deno, and build tools.
- `validator.mjs` validates state and normalized semantic observations without
  parsing HTML.
- `styles.css` is the shared relaxed layout for all 100 rendered items.
- `contract.test.mjs` pins the foundational contract.

## Semantic adapters

HTML or DOM adapters should query the selectors from `contract.mjs` and produce
the normalized shape returned by:

```js
const expected = createExpectedObservation(createTodoState(0));
```

The shape contains component names, selector and required-text counts, branch
counts, ordered item IDs, sentinel IDs, nested tag IDs by todo, and interaction
counts. Pass an adapter result to `validateObservation(observation, state)`.
The result is `{ valid, errors }`; `assertValidObservation` is the throwing
form.

No parser is intentionally bundled here. A Node HTML adapter, browser DOM
adapter, or framework test harness can collect the same normalized facts
without changing this validator API.

## Invariants agents may not change

- 100 items and 32 variants
- the component, branch, loop, interaction, selector, text, and sentinel lists
- item field names or precomputed labels
- state generation formulas, IDs, or snapshot immutability
- shared class names, `data-branch` tokens, or `data-action` values
- shared CSS

Changes to this folder are contract changes and must update its focused tests.
