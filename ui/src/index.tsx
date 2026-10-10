/**
 * The Spaces view's start: it connects to its host, reads the pages from
 * the app's store, takes up the pages shared in the app's rooms, and
 * opens the page open last, if there is one.
 */
import { createRoot } from 'react-dom/client';
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { Pages } from './pages.ts';
import { Platform } from './platform.ts';
import { Search } from './search.ts';
import { Shared } from './shared.ts';
import { Spaces } from './Spaces.tsx';
import sheet from './ui.css?inline';

const style = document.createElement('style');
style.textContent = sheet;
document.head.append(style);

const app = new App({ name: 'Spaces', version: '1.1.1' }, {}, { autoResize: false });
await app.connect(new PostMessageTransport(window.parent, window.parent));
const platform = new Platform(app);
const pages = new Pages(platform);
const shared = new Shared(platform, pages);

const entries = await shared.start(await pages.list());
const last = await pages.lastOpen();
const open = entries.find((e) => e.id === last) ?? entries[0] ?? null;

const root = document.createElement('div');
root.className = 'spaces-root';
document.body.append(root);
createRoot(root).render(
  <Spaces
    pages={pages}
    search={new Search(platform)}
    shared={shared}
    first={{ entries, open: open && { entry: open, body: await pages.body(open.id) } }}
  />,
);
