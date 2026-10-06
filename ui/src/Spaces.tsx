/**
 * The Spaces view, which fills the app's tab: the pages in a sidebar at
 * the left, with New page and the search, and the open page beside it.
 * A change is kept a moment after the typing stops, and the page moves to
 * the top of the list. A narrow tab shows the list or the page, with a
 * way back to the list.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageEditor } from './Editor.tsx';
import { Confirm, Icon, MarkPress, SettingsSearch } from './kit.tsx';
import { EMPTY, newId, type PageBody, type PageEntry, type Pages } from './pages.ts';
import type { Search } from './search.ts';

/** How long after the last keystroke a change is kept. */
const KEEP_MS = 500;
/** How long after the last kept change the pages' vectors are made. */
const INDEX_MS = 4000;
/** How long the search waits for the typing to stop. */
const QUERY_MS = 250;
/** The narrowest tab that shows the list beside the page. */
const WIDE = 600;

/** A change of the open page that waits to be kept. */
interface Pending {
  entry: PageEntry;
  body: PageBody | null;
}

export function Spaces({
  pages,
  search,
  first,
}: {
  pages: Pages;
  search: Search;
  first: { entries: PageEntry[]; open: PageEntry; body: PageBody };
}) {
  const [entries, setEntries] = useState(first.entries);
  const [open, setOpen] = useState<{ entry: PageEntry; body: PageBody }>({
    entry: first.open,
    body: first.body,
  });
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ ids: string[]; meaning: boolean } | null>(null);
  const [deleting, setDeleting] = useState<PageEntry | null>(null);
  const [wide, setWide] = useState(true);
  const [listShown, setListShown] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const pending = useRef<Pending | null>(null);
  const keepTimer = useRef<number>(0);
  const indexTimer = useRef<number>(0);
  /** Whether the app had an embedding model at the last try. */
  const meaning = useRef<boolean | null>(null);

  const allPages = useCallback(
    async (list: PageEntry[]) =>
      Promise.all(list.map(async (entry) => ({ entry, body: await pages.body(entry.id) }))),
    [pages],
  );

  const keep = useCallback(async () => {
    clearTimeout(keepTimer.current);
    const change = pending.current;
    if (!change) return;
    pending.current = null;
    const list = await pages.save(change.entry, change.body);
    setEntries(list);
    clearTimeout(indexTimer.current);
    if (meaning.current === false) return;
    indexTimer.current = window.setTimeout(() => {
      void allPages(list).then(async (all) => {
        meaning.current = await search.index(all);
      });
    }, INDEX_MS);
  }, [pages, search, allPages]);

  const change = (next: { title?: string; body?: PageBody }) => {
    const held = pending.current;
    const entry: PageEntry = {
      id: open.entry.id,
      title: next.title ?? held?.entry.title ?? open.entry.title,
      updated: new Date().toISOString(),
    };
    const body = next.body ?? held?.body ?? null;
    pending.current = { entry, body };
    setOpen((o) => ({ entry, body: body ?? o.body }));
    clearTimeout(keepTimer.current);
    keepTimer.current = window.setTimeout(() => void keep(), KEEP_MS);
  };

  const show = async (entry: PageEntry, body?: PageBody) => {
    await keep();
    setOpen({ entry, body: body ?? (await pages.body(entry.id)) });
    setListShown(false);
    await pages.keepOpen(entry.id);
  };

  const create = async () => {
    const entry: PageEntry = { id: newId(), title: '', updated: new Date().toISOString() };
    await keep();
    setEntries(await pages.save(entry, EMPTY));
    await show(entry, EMPTY);
  };

  const remove = async (entry: PageEntry) => {
    setDeleting(null);
    if (pending.current?.entry.id === entry.id) {
      clearTimeout(keepTimer.current);
      pending.current = null;
    }
    const list = await pages.remove(entry.id);
    setEntries(list);
    if (open.entry.id !== entry.id) return;
    const next = list[0];
    if (next) await show(next);
    else await create();
  };

  // A tab that hides keeps what the person typed.
  useEffect(() => {
    const flush = () => void keep();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [keep]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const sizes = new ResizeObserver(() => setWide(el.clientWidth >= WIDE));
    sizes.observe(el);
    return () => sizes.disconnect();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setFound(null);
      return;
    }
    let gone = false;
    const timer = window.setTimeout(() => {
      void keep()
        .then(() => pages.list())
        .then(allPages)
        .then((all) => search.find(query, all))
        .then((result) => {
          meaning.current = result.meaning;
          if (!gone) setFound(result);
        });
    }, QUERY_MS);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [query, pages, search, keep, allPages]);

  const byId = new Map(entries.map((e) => [e.id, e]));
  const rows = found ? found.ids.flatMap((id) => byId.get(id) ?? []) : entries;
  const sideShown = wide || listShown;
  const pageShown = wide || !listShown;

  return (
    <div ref={root} className="hs-app-surface spaces" data-wide={wide ? 'true' : 'false'}>
      {sideShown && (
        <div className="hs-sidebar-column spaces-side">
          <div className="hs-plugrow hs-inktext hs-app-row spaces-head">
            <span className="hs-sidebar-mark">
              <Icon name="booklet-line" size={16} />
            </span>
            Spaces
            <span className="hs-flex-spacer" />
            <MarkPress
              label="New page"
              className="hs-hovink hs-inkmut hs-sidebar-rowact"
              onPress={() => void create()}
            >
              <span className="hs-sidebar-plus">
                <Icon name="add-fill" size={16} />
              </span>
            </MarkPress>
          </div>
          <div className="spaces-search">
            <SettingsSearch value={query} placeholder="Search pages" onChange={setQuery} />
          </div>
          <div
            className="hs-scroll hs-sidebar-scroll spaces-list"
            data-found={found ? (found.meaning ? 'meaning' : 'words') : undefined}
          >
            {rows.map((entry) => (
              <div key={entry.id} className="hs-session-slot">
                <div
                  className={`hs-sessrow hs-hovbox-ink hs-inkmut hs-session-row${
                    entry.id === open.entry.id ? ' hs-boxsel' : ''
                  }`}
                  data-page={entry.id}
                  onClick={() => void show(entry)}
                >
                  <span className="hs-session-mark">
                    <Icon name="file-text-line" size={15} />
                  </span>
                  <span className="hs-stitle hs-session-label">
                    {(entry.id === open.entry.id ? open.entry.title : entry.title) || 'Untitled'}
                  </span>
                  <span className="hs-rowact hs-session-actions">
                    <MarkPress
                      label="Delete page"
                      className="hs-hovink hs-inkmut hs-session-menu-action"
                      onPress={() => setDeleting(entry)}
                    >
                      <Icon name="delete-bin-line" size={15} />
                    </MarkPress>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {pageShown && (
        <main className="hs-scroll spaces-page">
          {!wide && (
            <MarkPress
              label="Pages"
              className="hs-hovink hs-inkmut hs-sidebar-rowact spaces-back"
              onPress={() => setListShown(true)}
            >
              <Icon name="arrow-left-line" size={16} />
            </MarkPress>
          )}
          <PageEditor
            key={open.entry.id}
            title={open.entry.title}
            body={open.body}
            onTitle={(title) => change({ title })}
            onBody={(body) => change({ body })}
          />
        </main>
      )}
      {deleting && (
        <Confirm
          title={`Delete “${deleting.title || 'Untitled'}”?`}
          action="Delete"
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
