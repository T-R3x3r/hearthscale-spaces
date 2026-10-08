# Spaces

Pages you write, in a Hearthscale tab: headings, lists, checklists, quotes
and code, typed as you would in Markdown, kept on this computer. Share a
page with someone on another computer and write it together. Search finds
a page by its words, and by what it means when an embedding model is set.

Spaces is an ordinary Hearthscale app. Nothing in the platform knows its
name; it installs from the Marketplace like any other app.

## The view

Spaces shows one view, `spaces`, which fills its tab: the pages in a
sidebar with New page, Join a shared page and the search, and the open
page beside them, with its Share. A narrow tab shows the list or the page.
Its source is React under `ui/src`, drawn with the `hs-*` classes and
`ri-*` icons of the kit that Hearthscale loads into every view, with a
[Tiptap](https://tiptap.dev) editor (MIT).
Its build writes `views/spaces.js`, the one file the package carries for
it, so the file is committed with every change to the source:

```
cd ui
pnpm install
pnpm build
```

## Where the pages live

In the app's store, through the `store` extension: the list under
`pages`, the last changed first, each page's document and plain text under
`page:<id>`, a shared page's Yjs state under `shared:<id>`, and the page
open last under `open`. A change is kept half a second after the typing
stops. Spaces has no backend and reaches no network.

## Sharing a page

Through the `peers` extension. Share opens a room for the open page and
shows its ticket, a `hearthscale://join` link, with Copy link (the
`clipboard-write` permission). The other person opens the link, or presses
Join a shared page and pastes it; Hearthscale asks them to join in a sheet
of its own, so Spaces never picks a room. The page then comes into their
own Spaces, and both write it at the same time.

A shared page's title and words live in a [Yjs](https://yjs.dev) document
(MIT), bound to the editor by Tiptap's collaboration extension. Each change
goes to the room as a Yjs update. A computer that comes into the room, or
comes back after its connection dropped or Hearthscale started again,
sends the state it holds, and the others answer with what it lacks, so no
change is lost while it was away. A room message is at most 64 KiB, so a
longer one goes in parts.

Stop sharing ends the room for everyone; Leave takes this computer out.
When the room ends, each computer keeps its copy as an ordinary page.

## The search

Words always: a page is found when its title and text hold every word of
the query, each word matched from its start.

Meaning as well, through the `jobs` extension, while an embedding model is
set for Spaces or for the embedding role: each page's words, cut into
pieces at line ends, become vectors once per change, kept beside the page
under `vectors:<id>`, and a page is found when its nearest piece lies close
to the query's vector. Pages found by their words come first. Without an
embedding model the search uses the words alone.

## Working on it

With a Hearthscale platform running on this machine:

```
hearthscale dev .
```

links this folder into the running platform, picks up every change, and
asks once in the window before any code runs.

## Releasing

Install the Hearthscale registry's GitHub App on this repository once. Then
every release whose tag equals `version` in `app.json` is picked up by the
Marketplace.

```
hearthscale pack .
```

builds the package to attach to the release.

## Licence

MIT. See `LICENSE`.
