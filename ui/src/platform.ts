/**
 * What the view asks of the platform, through the extensions `uses`
 * names: the app's store, which keeps the pages, jobs, which turn words
 * into vectors on the app's embedding model, and peers, the rooms a page
 * is shared in with Spaces on other computers.
 */
import { App, McpUiMessageResultSchema as Answer } from '@modelcontextprotocol/ext-apps';

/** One job as the platform answers it. */
interface Job {
  id: string;
  card: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string[];
}

/** Vectors of texts, in the order of the texts, with the model card that
 *  made them: vectors of two cards do not compare. */
export interface Embedded {
  card: string;
  vectors: number[][];
}

/** One room the app is in: its ticket, a `hearthscale://join` link the
 *  person passes on, this computer's member id, the opener's, and the
 *  other members this computer is with now. */
export interface Room {
  id: string;
  app: string;
  ticket: string;
  me: string;
  opener: string;
  peers: string[];
}

/** What the platform tells the view of its rooms. */
interface Heard {
  'hearthscale/peers/message': { room: string; from: string; data: unknown };
  'hearthscale/peers/changed': { room: Room };
  'hearthscale/peers/ended': { room: string };
}

/** How often a running job is asked where it stands. */
const POLL_MS = 250;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Platform {
  private readonly heard = new Map<string, ((params: never) => void)[]>();

  constructor(private readonly app: App) {
    app.fallbackNotificationHandler = async ({ method, params }) => {
      for (const fn of this.heard.get(method) ?? []) fn(params as never);
    };
  }

  /** One request of the host, its result whole; the SDK's types name
   *  only its own methods, not the host's `hearthscale/*` ones. */
  private call<T>(method: string, params: object): Promise<T> {
    const request = this.app.request.bind(this.app) as (
      message: { method: string; params: object },
      schema: typeof Answer,
    ) => Promise<unknown>;
    return request({ method, params }, Answer) as Promise<T>;
  }

  on<M extends keyof Heard>(method: M, fn: (params: Heard[M]) => void): void {
    this.heard.set(method, [...(this.heard.get(method) ?? []), fn as (params: never) => void]);
  }

  /** A value of the store; null for a key that holds nothing. */
  async get<T>(key: string): Promise<T | null> {
    return (await this.call<{ value: T | null }>('hearthscale/store/get', { key })).value;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.call('hearthscale/store/set', { key, value });
  }

  async delete(key: string): Promise<void> {
    await this.call('hearthscale/store/delete', { key });
  }

  async rooms(): Promise<Room[]> {
    return (await this.call<{ rooms: Room[] }>('hearthscale/peers/rooms', {})).rooms;
  }

  /** A new room, opened on the person's click. */
  async create(): Promise<Room> {
    return (await this.call<{ room: Room }>('hearthscale/peers/create', {})).room;
  }

  /** The room whose ticket the person gives in the platform's sheet, on
   *  the person's click; null when they cancel. */
  async join(): Promise<Room | null> {
    return (await this.call<{ room: Room | null }>('hearthscale/peers/join', {})).room;
  }

  async send(room: string, data: unknown): Promise<void> {
    await this.call('hearthscale/peers/send', { room, data });
  }

  async leave(room: string): Promise<void> {
    await this.call('hearthscale/peers/leave', { room });
  }

  /** The vectors of texts on the app's embedding model; null while the
   *  app has no embedding model, or the model did not answer. */
  async embed(texts: string[]): Promise<Embedded | null> {
    let job: Job;
    try {
      ({ job } = await this.call<{ job: Job }>('hearthscale/jobs/submit', {
        kind: 'embedding',
        input: { texts },
      }));
      while (job.status === 'queued' || job.status === 'running') {
        await wait(POLL_MS);
        ({ job } = await this.call<{ job: Job }>('hearthscale/jobs/get', { id: job.id }));
      }
    } catch {
      return null;
    }
    const asset = job.result?.[0];
    if (job.status !== 'completed' || !asset) return null;
    const read = await this.app.readServerResource({ uri: `hearthscale-asset://${asset}` });
    const content = read.contents[0];
    if (!content) return null;
    const json = 'text' in content ? content.text : atob(content.blob);
    return { card: job.card, vectors: JSON.parse(json) as number[][] };
  }
}
