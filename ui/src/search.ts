/**
 * The search over the pages. Words always: a page whose title and text
 * hold every word of the query. Meaning as well while the app has an
 * embedding model: each page's words, cut into pieces, become vectors once
 * per change, kept beside the page, and a page whose nearest piece lies
 * close to the query's vector is found by what it means.
 */
import { vectorsKey, type PageBody, type PageEntry } from './pages.ts';
import type { Platform } from './platform.ts';

/** A page's vectors and what they were made from. */
interface Indexed {
  card: string;
  /** The hash of the words the vectors were made from. */
  hash: string;
  vectors: number[][];
}

/** The longest piece of a page one vector stands for, in characters. */
const PIECE = 800;
/** A page found by meaning lies at least this share of the best
 *  page's closeness. */
const NEAR = 0.8;

const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** The FNV-1a hash of a text, in hex. */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** A page's words cut into pieces at line ends, the title leading the
 *  first. */
function piecesOf(entry: PageEntry, body: PageBody): string[] {
  const pieces: string[] = [];
  let piece = entry.title;
  for (const line of body.text.split('\n')) {
    if (piece && piece.length + line.length + 1 > PIECE) {
      pieces.push(piece);
      piece = '';
    }
    for (let at = 0; at < line.length; at += PIECE) {
      const part = line.slice(at, at + PIECE);
      piece = piece ? `${piece}\n${part}` : part;
    }
  }
  if (piece.trim()) pieces.push(piece);
  return pieces.length > 0 ? pieces : [entry.title || ' '];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Whether a page's title and text hold every word of the query. */
export function holdsWords(entry: PageEntry, body: PageBody, query: string): boolean {
  const held = new Set(wordsOf(`${entry.title}\n${body.text}`));
  const asked = wordsOf(query);
  return asked.length > 0 && asked.every((w) => [...held].some((h) => h.startsWith(w)));
}

export class Search {
  constructor(private readonly platform: Platform) {}

  /** Makes, in one job, the vectors of the pages whose words changed
   *  since their vectors were made, or whose vectors another card made
   *  than `card`, when named; false while the app has no embedding
   *  model. */
  async index(pages: { entry: PageEntry; body: PageBody }[], card?: string): Promise<boolean> {
    const stale: { id: string; hash: string; pieces: string[] }[] = [];
    for (const { entry, body } of pages) {
      const hash = hashOf(`${entry.title}\n${body.text}`);
      const kept = await this.platform.get<Indexed>(vectorsKey(entry.id));
      if (kept?.hash !== hash || (card !== undefined && kept.card !== card)) {
        stale.push({ id: entry.id, hash, pieces: piecesOf(entry, body) });
      }
    }
    if (stale.length === 0) return true;
    const embedded = await this.platform.embed(stale.flatMap((s) => s.pieces));
    if (!embedded) return false;
    let at = 0;
    for (const s of stale) {
      const vectors = embedded.vectors.slice(at, at + s.pieces.length);
      at += s.pieces.length;
      await this.platform.set(vectorsKey(s.id), {
        card: embedded.card,
        hash: s.hash,
        vectors,
      } satisfies Indexed);
    }
    return true;
  }

  /** The pages a query finds, the closest first: by its words, and by
   *  its meaning while the app has an embedding model. */
  async find(
    query: string,
    pages: { entry: PageEntry; body: PageBody }[],
  ): Promise<{ ids: string[]; meaning: boolean }> {
    const worded = pages.filter((p) => holdsWords(p.entry, p.body, query)).map((p) => p.entry.id);
    const asked = await this.platform.embed([query]);
    const vector = asked?.vectors[0];
    if (!asked || !vector || !(await this.index(pages, asked.card))) {
      return { ids: worded, meaning: false };
    }
    const close = new Map<string, number>();
    for (const { entry } of pages) {
      const kept = await this.platform.get<Indexed>(vectorsKey(entry.id));
      if (kept?.card !== asked.card) continue;
      close.set(entry.id, Math.max(0, ...kept.vectors.map((v) => cosine(vector, v))));
    }
    const best = Math.max(0, ...close.values());
    const meant = [...close.entries()]
      .filter(([id, c]) => !worded.includes(id) && best > 0 && c >= best * NEAR)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    const byClose = (a: string, b: string) => (close.get(b) ?? 0) - (close.get(a) ?? 0);
    return { ids: [...[...worded].sort(byClose), ...meant], meaning: true };
  }
}
