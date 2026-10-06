/**
 * The pages and how the app's store keeps them: the list under `pages`,
 * newest change first, each page's words under `page:<id>`, its vectors
 * under `vectors:<id>`, and the page last open under `open`.
 */
import type { JSONContent } from '@tiptap/core';
import type { Platform } from './platform.ts';

/** A page in the list. */
export interface PageEntry {
  id: string;
  title: string;
  /** ISO time of the last change. */
  updated: string;
}

/** A page's words: the editor's document, and its plain text, which the
 *  search reads. */
export interface PageBody {
  doc: JSONContent;
  text: string;
}

export const bodyKey = (id: string) => `page:${id}`;
export const vectorsKey = (id: string) => `vectors:${id}`;

/** A new page's id: twelve hex digits. */
export const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

export const EMPTY: PageBody = { doc: { type: 'doc', content: [{ type: 'paragraph' }] }, text: '' };

/** Each change reads the list and writes it whole, so changes run one
 *  after another. */
export class Pages {
  private last: Promise<unknown> = Promise.resolve();

  constructor(private readonly platform: Platform) {}

  private inTurn<T>(change: () => Promise<T>): Promise<T> {
    const next = this.last.then(change, change);
    this.last = next.catch(() => undefined);
    return next;
  }

  async list(): Promise<PageEntry[]> {
    return (await this.platform.get<PageEntry[]>('pages')) ?? [];
  }

  async body(id: string): Promise<PageBody> {
    return (await this.platform.get<PageBody>(bodyKey(id))) ?? EMPTY;
  }

  /** Keeps a page's words and puts it first in the list, which answers. */
  save(entry: PageEntry, body: PageBody | null): Promise<PageEntry[]> {
    return this.inTurn(async () => {
      if (body) await this.platform.set(bodyKey(entry.id), body);
      const next = [entry, ...(await this.list()).filter((p) => p.id !== entry.id)];
      await this.platform.set('pages', next);
      return next;
    });
  }

  /** Deletes a page with its words and its vectors; answers the list. */
  remove(id: string): Promise<PageEntry[]> {
    return this.inTurn(async () => {
      const next = (await this.list()).filter((p) => p.id !== id);
      await this.platform.set('pages', next);
      await this.platform.delete(bodyKey(id));
      await this.platform.delete(vectorsKey(id));
      return next;
    });
  }

  async lastOpen(): Promise<string | null> {
    return this.platform.get<string>('open');
  }

  async keepOpen(id: string): Promise<void> {
    await this.platform.set('open', id);
  }
}
