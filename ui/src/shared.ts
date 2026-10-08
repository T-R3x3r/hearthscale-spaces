/**
 * Pages shared with Spaces on other computers, each in a room of the
 * platform. A shared page's title and words live in a Yjs document that
 * every member holds a copy of, and each change travels to the others as
 * a Yjs update in a room message. A member that comes into a room, or
 * comes back to it, sends the state it holds, and every other member
 * answers with what that state lacks, so no member loses the changes made
 * while it was away. The opener's page comes into a joiner's own pages
 * with the first state that reaches it. When the room ends, each member
 * keeps its copy as an ordinary page.
 *
 * A room message is at most 64 KiB of JSON. A message longer than one
 * part goes as parts in order, which the receiver puts together again.
 */
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap';
import { newId, type PageBody, type PageEntry, type Pages } from './pages.ts';
import type { Platform, Room } from './platform.ts';
import { schema, textOf } from './schema.ts';

/** The origin of the changes that came from the room, which go to no one. */
const REMOTE = Symbol('remote');
/** The most characters of a message's JSON one part carries. */
const PART = 48_000;
/** How long local changes gather before they go to the room. */
const BATCH_MS = 40;
/** How long after the last change a shared page is kept. */
const KEEP_MS = 500;
/** The Yjs fragment of a page's words and the map of its title. */
const WORDS = 'default';
const META = 'page';

/** A room message: the sender's state, which each other member answers
 *  with what it lacks; changes; or one part of a longer message. */
type Wire =
  | { t: 'state'; sv: string }
  | { t: 'update'; u: string }
  | { t: 'part'; id: string; i: number; n: number; s: string };

/** A page in a room, with the changes that wait to go and to be kept. */
interface Held {
  page: string;
  doc: Y.Doc;
  outbox: Uint8Array[];
  sendTimer: number;
  keepTimer: number;
  /** Stops sending and keeping the document's changes. */
  stop(): void;
}

/** What the view hears of its shared pages. */
export interface SharedEvents {
  /** A shared page was kept after a change; the list as it stands. */
  saved(list: PageEntry[], entry: PageEntry): void;
  /** A page came from a room this computer joined. */
  arrived(entry: PageEntry): void;
  /** A page's room ended; the page is an ordinary page again. */
  unshared(list: PageEntry[], id: string): void;
  /** A room's members changed. */
  changed(room: Room): void;
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(text);
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Whether an update holds any change. */
function changes(update: Uint8Array): boolean {
  const { structs, ds } = Y.decodeUpdate(update);
  return structs.length > 0 || ds.clients.size > 0;
}

const titleOf = (doc: Y.Doc) => String(doc.getMap(META).get('title') ?? '');

export class Shared {
  /** The pages in rooms, by room. */
  private readonly held = new Map<string, Held>();
  /** The rooms this computer joined whose page has not come yet. */
  private readonly waiting = new Map<string, Y.Doc>();
  private readonly rooms = new Map<string, Room>();
  /** The parts of a long message as they come, by room and sender. */
  private readonly parts = new Map<string, { id: string; got: string[] }>();
  private sending: Promise<unknown> = Promise.resolve();
  private events: SharedEvents | null = null;

  constructor(
    private readonly platform: Platform,
    private readonly pages: Pages,
  ) {
    platform.on('hearthscale/peers/message', ({ room, from, data }) =>
      this.heard(room, from, data),
    );
    platform.on('hearthscale/peers/changed', ({ room }) => this.roomChanged(room));
    platform.on('hearthscale/peers/ended', ({ room }) => void this.ended(room));
  }

  listen(events: SharedEvents): void {
    this.events = events;
  }

  /** Takes up the pages of the rooms the app is in: a page whose room
   *  ended while the view was away is an ordinary page again, and a room
   *  this computer opened for a page that is gone ends. Answers the
   *  list. */
  async start(entries: PageEntry[]): Promise<PageEntry[]> {
    const rooms = await this.platform.rooms();
    for (const room of rooms) this.rooms.set(room.id, room);
    let list = entries;
    for (const entry of entries) {
      if (!entry.room) continue;
      if (!this.rooms.has(entry.room)) {
        list = await this.pages.unshare(entry.id);
        continue;
      }
      const doc = new Y.Doc();
      const kept = await this.pages.shared(entry.id);
      if (kept) Y.applyUpdate(doc, fromBase64(kept), REMOTE);
      this.hold(entry.room, entry.id, doc);
    }
    for (const room of rooms) {
      if (this.held.has(room.id)) continue;
      if (room.opener === room.me) await this.platform.leave(room.id);
      else this.waiting.set(room.id, new Y.Doc());
    }
    for (const room of this.rooms.values()) this.offer(room.id);
    return list;
  }

  room(id: string | undefined): Room | null {
    return (id !== undefined && this.rooms.get(id)) || null;
  }

  /** The document of a page in a room. */
  doc(page: string): Y.Doc | null {
    for (const held of this.held.values()) if (held.page === page) return held.doc;
    return null;
  }

  /** Shares a page in a new room, on the person's click; answers the
   *  page as it stands in the room. */
  async share(entry: PageEntry, body: PageBody): Promise<PageEntry> {
    const room = await this.platform.create();
    this.rooms.set(room.id, room);
    const doc = prosemirrorJSONToYDoc(schema, body.doc, WORDS);
    doc.getMap(META).set('title', entry.title);
    return this.keep(room.id, this.hold(room.id, entry.id, doc));
  }

  /** Joins a room through the platform's sheet, on the person's click;
   *  its page comes with the room's first state. */
  async join(): Promise<void> {
    const room = await this.platform.join();
    if (room) this.roomChanged(room);
  }

  /** Takes a page out of its room; a room this computer opened ends for
   *  everyone in it. */
  async leave(entry: PageEntry): Promise<void> {
    if (entry.room) await this.platform.leave(entry.room);
  }

  setTitle(page: string, title: string): void {
    this.doc(page)?.getMap(META).set('title', title);
  }

  private hold(room: string, page: string, doc: Y.Doc): Held {
    const changed = (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) {
        held.outbox.push(update);
        if (!held.sendTimer) held.sendTimer = window.setTimeout(() => this.flush(room), BATCH_MS);
      }
      clearTimeout(held.keepTimer);
      held.keepTimer = window.setTimeout(() => void this.keep(room, held), KEEP_MS);
    };
    const held: Held = {
      page,
      doc,
      outbox: [],
      sendTimer: 0,
      keepTimer: 0,
      stop: () => {
        doc.off('update', changed);
        clearTimeout(held.sendTimer);
        clearTimeout(held.keepTimer);
      },
    };
    this.held.set(room, held);
    doc.on('update', changed);
    return held;
  }

  /** Keeps a shared page now: its words, its plain text, its title and
   *  its state. */
  private async keep(room: string, held: Held): Promise<PageEntry> {
    clearTimeout(held.keepTimer);
    const node = yXmlFragmentToProseMirrorRootNode(held.doc.getXmlFragment(WORDS), schema);
    const entry: PageEntry = {
      id: held.page,
      title: titleOf(held.doc),
      updated: new Date().toISOString(),
      room,
    };
    const list = await this.pages.save(
      entry,
      { doc: node.toJSON(), text: textOf(node) },
      toBase64(Y.encodeStateAsUpdate(held.doc)),
    );
    this.events?.saved(list, entry);
    return entry;
  }

  private flush(room: string): void {
    const held = this.held.get(room);
    if (!held) return;
    held.sendTimer = 0;
    this.send(room, { t: 'update', u: toBase64(Y.mergeUpdates(held.outbox.splice(0))) });
  }

  /** Sends the state this computer holds of a room's page, for the
   *  others to answer with what it lacks. */
  private offer(room: string): void {
    const doc = this.held.get(room)?.doc ?? this.waiting.get(room);
    if (doc) this.send(room, { t: 'state', sv: toBase64(Y.encodeStateVector(doc)) });
  }

  /** Sends a message, in parts when it is long, after the ones before
   *  it. A message that does not go is lost: the next offer of a state
   *  brings what it carried. */
  private send(room: string, wire: Wire): void {
    const text = JSON.stringify(wire);
    const messages: Wire[] = [];
    if (text.length <= PART) messages.push(wire);
    else {
      const id = newId();
      const n = Math.ceil(text.length / PART);
      for (let i = 0; i < n; i++) {
        messages.push({ t: 'part', id, i, n, s: text.slice(i * PART, (i + 1) * PART) });
      }
    }
    this.sending = this.sending
      .then(async () => {
        for (const message of messages) await this.platform.send(room, message);
      })
      .catch(() => undefined);
  }

  /** A whole message from its parts as they come; null while parts are
   *  missing, or for data that is no message of Spaces. */
  private whole(room: string, from: string, data: unknown): Wire | null {
    const wire = data as Wire | null;
    if (wire?.t === 'state' || wire?.t === 'update') return wire;
    if (wire?.t !== 'part') return null;
    const key = `${room}\n${from}`;
    let held = this.parts.get(key);
    if (held?.id !== wire.id) {
      held = { id: wire.id, got: [] };
      this.parts.set(key, held);
    }
    held.got[wire.i] = wire.s;
    if (held.got.filter((s) => s !== undefined).length < wire.n) return null;
    this.parts.delete(key);
    try {
      return this.whole(room, from, JSON.parse(held.got.join('')));
    } catch {
      return null;
    }
  }

  private heard(room: string, from: string, data: unknown): void {
    const wire = this.whole(room, from, data);
    const doc = this.held.get(room)?.doc ?? this.waiting.get(room);
    if (!wire || !doc) return;
    if (wire.t === 'state') {
      const lacking = Y.encodeStateAsUpdate(doc, fromBase64(wire.sv));
      if (changes(lacking)) this.send(room, { t: 'update', u: toBase64(lacking) });
      return;
    }
    if (wire.t === 'update') {
      Y.applyUpdate(doc, fromBase64(wire.u), REMOTE);
      if (this.waiting.has(room)) void this.arrive(room, doc);
    }
  }

  /** The first state of a joined room's page: the page comes into this
   *  computer's pages. */
  private async arrive(room: string, doc: Y.Doc): Promise<void> {
    this.waiting.delete(room);
    this.events?.arrived(await this.keep(room, this.hold(room, newId(), doc)));
  }

  private roomChanged(room: Room): void {
    this.rooms.set(room.id, room);
    this.events?.changed(room);
    if (!this.held.has(room.id) && !this.waiting.has(room.id)) {
      // A room this computer opens is held by the share that opens it.
      if (room.opener === room.me) return;
      this.waiting.set(room.id, new Y.Doc());
    }
    if (room.peers.length > 0) this.offer(room.id);
  }

  private async ended(room: string): Promise<void> {
    this.rooms.delete(room);
    this.waiting.delete(room);
    const held = this.held.get(room);
    if (!held) return;
    this.held.delete(room);
    held.stop();
    await this.keep(room, held);
    held.doc.destroy();
    const list = await this.pages.unshare(held.page);
    this.events?.unshared(list, held.page);
  }
}
