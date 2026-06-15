---
name: deck-review
description: Open an HTML deck in the review playground (region selection + per-slide notes) so the user can leave structured feedback that Claude reads back later
---

# Deck-review — annotated review of an HTML deck

This skill opens a local web tool that iframes an HTML deck next to a notes panel, lets the user **draw rectangular regions** and **write per-slide notes**, and persists everything to a JSON file Claude can read.

> Not to be confused with the marketplace `playground:playground` skill, which **builds** interactive parameter-tweakable HTML tools. This one **reviews** an existing deck.

## When to invoke

- User says `/deck-review`, "open the deck-review", "open the playground", "let me annotate the deck", or similar.
- User asks to read or act on previously-left feedback (e.g., "implement the deck-review notes", "look at my annotations").

## Argument

The skill takes one optional argument: a path to a bundle that contains a `playground/` subfolder with `server.py`.

- If the user passes a path → use that.
- If the user invokes bare `/deck-review` → look in the **current working directory** for a `playground/server.py`. If not found, walk up parent dirs until found, or check the most recently-discussed bundle in the conversation.

## How to launch (when user wants to open it)

1. Find `<bundle>/playground/server.py` (see locating logic above).
2. Confirm the bundle path with the user **only if ambiguous** (multiple candidate bundles in scope). Otherwise just go.
3. Start the server in the **background** so the conversation isn't blocked:
   ```bash
   python3 <bundle>/playground/server.py [port]
   ```
   Default port `8765`. If that's busy, pick a higher one (8766, 8767, …) and tell the user.
4. Tell the user the URL to open: `http://localhost:<port>/playground/`. Don't open a browser yourself.
5. Mention the key shortcuts so they don't have to re-read the README:
   - <kbd>R</kbd> toggles region-select mode
   - drag to draw a region → dialog asks for a note
   - notes & regions auto-save to `<bundle>/playground/annotations.json`

**Don't stop the server just because the conversation moves on.** It's fine for the playground to keep running in the background until the user explicitly asks to stop it. If a server is already running on the chosen port, don't start another one — re-use the existing process.

## How to read feedback (when user wants action)

Read `<bundle>/playground/annotations.json`. Schema:

```jsonc
{
  "deck": "<deck title>",
  "designSize": { "w": 1920, "h": 1080 },
  "updatedAt": "<ISO>",
  "annotations": [
    {
      "id": "a-...",
      "slide": 7,
      "slideLabel": "07 Defeitos induzidos",
      "type": "note" | "region",
      "text": "<user's comment>",
      "rect": { "x": 412, "y": 280, "w": 880, "h": 360 }, // region only, deck coords (1920×1080)
      "createdAt": "<ISO>",
      "updatedAt": "<ISO>"  // present if edited
    }
  ]
}
```

To map a region back to deck content, locate the slide by its `slideLabel` or `slide` index in the deck HTML's `data-screen-label` attribute, then find the elements that overlap the `rect` (deck coords). Coordinates are stable because the deck has a fixed 1920×1080 design canvas.

## How to act on feedback

For each annotation:

1. State which slide and what the user asked for, in one short line.
2. Make the edit in the deck HTML (or whatever file owns that content).
3. After the edit, **leave the annotation in the JSON** — don't delete it. The user clears it manually when satisfied. (You may add a `resolved: true` field or a `claudeNote` field if you want to record what you did, but ask first if you're going to mutate the file.)

If multiple annotations conflict or the user's intent is unclear from the text, ask before guessing.

## Constraints

- The server runs on `127.0.0.1` only — never bind to `0.0.0.0` or expose to a LAN.
- `annotations.json` is the single source of truth — don't introduce a second store.
- The playground relies on **same-origin** iframe access. Don't move the deck to a different port/host.

## Files this skill touches

- Reads: `<bundle>/playground/annotations.json`
- Starts: `<bundle>/playground/server.py` (in background)
- Modifies: deck files (HTML/CSS/JS) inside the bundle, in response to annotations.

Do NOT modify the playground UI itself (`playground/index.html`, `.js`, `.css`, `server.py`) in response to deck-feedback — that's a separate scope and should be raised explicitly.
