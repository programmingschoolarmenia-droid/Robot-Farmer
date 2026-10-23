// Tiny publish/subscribe bus. Engine modules emit, UI modules listen.
export class Events {
  constructor() {
    this.handlers = new Map();
  }

  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) {
    const set = this.handlers.get(name);
    if (set) set.delete(fn);
  }

  emit(name, payload) {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`Event handler for "${name}" failed`, err);
      }
    }
  }
}
