/**
 * What the view asks of the platform, through the extensions `uses`
 * names: the app's store, which keeps the pages, and jobs, which turn
 * words into vectors on the app's embedding model.
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

/** How often a running job is asked where it stands. */
const POLL_MS = 250;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Platform {
  constructor(private readonly app: App) {}

  /** One request of the host, its result whole; the SDK's types name
   *  only its own methods, not the host's `hearthscale/*` ones. */
  private call<T>(method: string, params: object): Promise<T> {
    const request = this.app.request.bind(this.app) as (
      message: { method: string; params: object },
      schema: typeof Answer,
    ) => Promise<unknown>;
    return request({ method, params }, Answer) as Promise<T>;
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
