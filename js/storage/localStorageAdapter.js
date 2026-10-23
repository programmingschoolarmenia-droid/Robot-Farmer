// Storage behind a tiny interface so it can later be replaced by an online backend.
export class LocalStorageAdapter {
  constructor(prefix = 'bridgysFarm.') {
    this.prefix = prefix;
    this.memory = new Map(); // fallback when localStorage is blocked
    this.available = true;
    try {
      const k = `${prefix}__test`;
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
    } catch {
      this.available = false;
    }
  }

  get(key) {
    const k = this.prefix + key;
    if (!this.available) return this.memory.has(k) ? this.memory.get(k) : null;
    try {
      return window.localStorage.getItem(k);
    } catch {
      return this.memory.get(k) ?? null;
    }
  }

  set(key, value) {
    const k = this.prefix + key;
    if (!this.available) {
      this.memory.set(k, value);
      return true;
    }
    try {
      window.localStorage.setItem(k, value);
      return true;
    } catch (e) {
      console.warn('Saving failed', e);
      this.memory.set(k, value);
      return false;
    }
  }

  remove(key) {
    const k = this.prefix + key;
    this.memory.delete(k);
    if (!this.available) return;
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}
