import type { FeedbinCredentials, FeedbinEntry, FeedbinTagging } from "./types";

export interface FeedbinClientOptions {
  credentials: FeedbinCredentials;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.feedbin.com/v2";

export class FeedbinClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly authHeader: string;

  constructor(opts: FeedbinClientOptions) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    // The global fetch is `this`-sensitive: calling it as a method
    // (this.fetchFn(...)) triggers "Illegal invocation" in the Workers
    // runtime. Bind it to globalThis so the default path is safe.
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.authHeader =
      "Basic " + btoa(`${opts.credentials.email}:${opts.credentials.password}`);
  }

  protected async get(path: string): Promise<Response> {
    return this.fetchFn(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: this.authHeader },
    });
  }

  async verifyCredentials(): Promise<boolean> {
    const res = await this.get("/authentication.json");
    return res.status === 200;
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.get(path);
    if (!res.ok) {
      throw new Error(`Feedbin GET ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async getUnreadEntryIds(): Promise<number[]> {
    return this.getJson<number[]>("/unread_entries.json");
  }

  async getStarredEntryIds(): Promise<number[]> {
    return this.getJson<number[]>("/starred_entries.json");
  }

  async getTaggings(): Promise<FeedbinTagging[]> {
    return this.getJson<FeedbinTagging[]>("/taggings.json");
  }

  async getEntriesByIds(ids: number[]): Promise<FeedbinEntry[]> {
    const out: FeedbinEntry[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const entries = await this.getJson<FeedbinEntry[]>(
        `/entries.json?ids=${batch.join(",")}`,
      );
      out.push(...entries);
    }
    return out;
  }
}
