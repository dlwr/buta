import type { FeedbinCredentials } from "./types";

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
    this.fetchFn = opts.fetchFn ?? fetch;
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
}
