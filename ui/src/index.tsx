/**
 * The Spaces view's start: it connects to its host, reads the pages from
 * the app's store, and opens the page open last; with no page yet it
 * starts the first one.
 */
import { createRoot } from 'react-dom/client';
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { EMPTY, newId, Pages, type PageEntry } from './pages.ts';
import { Platform } from './platform.ts';
import { Search } from './search.ts';
import { Spaces } from './Spaces.tsx';
import sheet from './ui.css?inline';

const style = document.createElement('style');
style.textContent = sheet;
document.head.append(style);

const app = new App({ name: 'Spaces', version: '1.0.0' }, {}, { autoResize: false });
await app.connect(new PostMessageTransport(window.parent, window.parent));
const platform = new Platform(app);
const pages = new Pages(platform);

let entries = await pages.list();
const last = await pages.lastOpen();
let open = entries.find((e) => e.id === last) ?? entries[0];
if (!open) {
  open = { id: newId(), title: '', updated: new Date().toISOString() } satisfies PageEntry;
  entries = await pages.save(open, EMPTY);
}

const root = document.createElement('div');
root.className = 'spaces-root';
document.body.append(root);
createRoot(root).render(
  <Spaces
    pages={pages}
    search={new Search(platform)}
    first={{ entries, open, body: await pages.body(open.id) }}
  />,
);
