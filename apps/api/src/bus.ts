/** In-process event bus feeding SSE, with a ring buffer for Last-Event-ID recovery. */
type Listener = (e: BusEvent) => void;
export interface BusEvent { id: number; type: string; at: number; data: unknown }
class Bus {
  private seq = 0;
  private ring: BusEvent[] = [];
  private listeners = new Set<Listener>();
  publish(type: string, data: unknown) {
    const e = { id: ++this.seq, type, at: Date.now(), data };
    this.ring.push(e);
    if (this.ring.length > 1000) this.ring.shift();
    for (const l of this.listeners) l(e);
  }
  since(id: number) { return this.ring.filter((e) => e.id > id); }
  get lastId() { return this.seq; }
  get clients() { return this.listeners.size; }
  subscribe(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
}
export const bus = new Bus();
