import { ViewedBuffer } from "./viewed-buffer";

interface Entry {
  id: number; feed_id: number; title: string | null;
  url: string | null; created_at: string | null;
}
interface Selection { tier1: Entry[]; tier2: Entry[] }

const buffer = new ViewedBuffer();
let rows: HTMLLIElement[] = [];
let cursor = -1;

function token(): string {
  let t = localStorage.getItem("buta_token");
  if (!t) {
    t = prompt("token?") ?? "";
    localStorage.setItem("buta_token", t);
  }
  return t;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token()}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("buta_token");
    throw new Error("unauthorized");
  }
  return res;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(5, 10).replace("-", "/");
}

const observer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    // Row has scrolled past the top edge -> the user has seen it.
    if (!e.isIntersecting && e.boundingClientRect.bottom < 0) {
      markViewed(e.target as HTMLLIElement);
    }
  }
}, { rootMargin: "0px" });

function markViewed(row: HTMLLIElement): void {
  const id = Number(row.dataset["id"]);
  if (buffer.add(id)) row.classList.add("read");
}

function makeRow(entry: Entry): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "row";
  li.dataset["id"] = String(entry.id);
  li.dataset["url"] = entry.url ?? "";

  const title = document.createElement("span");
  title.className = "title";
  title.textContent = entry.title || "(no title)";
  title.addEventListener("click", () => openRow(li));

  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = fmtDate(entry.created_at);

  const star = document.createElement("button");
  star.className = "star";
  star.textContent = "★";
  star.setAttribute("aria-label", "star");
  star.addEventListener("click", () => void toggleStar(li, star));

  li.append(title, meta, star);
  observer.observe(li);
  return li;
}

function openRow(row: HTMLLIElement): void {
  markViewed(row);
  const url = row.dataset["url"];
  if (url) window.open(url, "_blank", "noopener");
}

async function toggleStar(row: HTMLLIElement, btn: HTMLButtonElement): Promise<void> {
  const starred = !btn.classList.contains("on");
  btn.classList.toggle("on", starred);
  try {
    await api("/star", {
      method: "POST",
      body: JSON.stringify({ entryIds: [Number(row.dataset["id"])], starred }),
    });
  } catch {
    btn.classList.toggle("on", !starred); // revert on failure
  }
}

async function flush(keepalive = false): Promise<void> {
  const ids = buffer.drain();
  if (ids.length === 0) return;
  try {
    await api("/viewed", {
      method: "POST", keepalive,
      body: JSON.stringify({ entryIds: ids }),
    });
  } catch {
    buffer.restore(ids);
  }
}

function setCursor(i: number): void {
  rows[cursor]?.classList.remove("cursor");
  cursor = Math.max(0, Math.min(i, rows.length - 1));
  const row = rows[cursor];
  if (!row) return;
  row.classList.add("cursor");
  row.scrollIntoView({ block: "center" });
  markViewed(row); // moving the cursor onto a row counts as seeing it
}

document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "j") setCursor(cursor + 1);
  else if (e.key === "k") setCursor(cursor - 1);
  else if (e.key === "s" && rows[cursor]) {
    const btn = rows[cursor]!.querySelector<HTMLButtonElement>(".star")!;
    void toggleStar(rows[cursor]!, btn);
  } else if ((e.key === "o" || e.key === "Enter") && rows[cursor]) {
    openRow(rows[cursor]!);
  }
});

async function load(): Promise<void> {
  await flush();
  const res = await api("/feed");
  const sel = (await res.json()) as Selection;

  const list = document.getElementById("list")!;
  list.textContent = "";
  rows = [];
  cursor = -1;

  for (const e of sel.tier1) {
    const row = makeRow(e);
    list.append(row);
    rows.push(row);
  }
  const seam = document.createElement("li");
  seam.className = "seam";
  seam.textContent = "ここから長い尾";
  list.append(seam);
  for (const e of sel.tier2) {
    const row = makeRow(e);
    list.append(row);
    rows.push(row);
  }
  document.getElementById("end")!.hidden = false;
}

document.getElementById("reload")!.addEventListener("click", () => void load());
document.getElementById("next")!.addEventListener("click", () => void load());
document.getElementById("cleanup")!.addEventListener("click", () => {
  const days = Number(prompt("何日以上前の尾を既読にする？", "7"));
  if (!Number.isFinite(days) || days <= 0) return;
  void api("/cleanup", { method: "POST", body: JSON.stringify({ olderThanDays: days }) })
    .then(async (r) => {
      const { read } = (await r.json()) as { read: number };
      alert(`${read} 件を既読にした`);
      return load();
    });
});

setInterval(() => void flush(), 4000);
window.addEventListener("pagehide", () => void flush(true));

void load();
