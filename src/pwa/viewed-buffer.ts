export class ViewedBuffer {
  private pending = new Set<number>();
  private reported = new Set<number>();

  add(id: number): boolean {
    if (this.pending.has(id) || this.reported.has(id)) return false;
    this.pending.add(id);
    return true;
  }

  drain(): number[] {
    const out = [...this.pending];
    for (const id of out) {
      this.pending.delete(id);
      this.reported.add(id);
    }
    return out;
  }

  restore(ids: number[]): void {
    for (const id of ids) {
      this.reported.delete(id);
      this.pending.add(id);
    }
  }
}
