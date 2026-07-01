export interface FeedbinEntry {
  id: number;
  feed_id: number;
  title: string | null;
  url: string | null;
  author: string | null;
  summary: string | null;
  content: string | null;
  published: string | null;
  created_at: string | null;
}

export interface FeedbinTagging {
  id: number;
  feed_id: number;
  name: string;
}

export interface FeedbinCredentials {
  email: string;
  password: string;
}
