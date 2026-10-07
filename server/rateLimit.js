// Small in-memory rate limiters. Good enough for a single Codespace demo server.

export class WindowLimiter {
  constructor({ limit, windowMs, now = Date.now }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map();
  }

  // Returns { ok, retryAfterSeconds }
  take(key) {
    if (this.limit === 0) return { ok: true, retryAfterSeconds: 0 };
    const now = this.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { ok: false, retryAfterSeconds: Math.ceil((recent[0] + this.windowMs - now) / 1000) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(now);
    return { ok: true, retryAfterSeconds: 0 };
  }

  prune(now) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

export class DailyCounter {
  constructor({ limit, now = Date.now }) {
    this.limit = limit;
    this.now = now;
    this.day = "";
    this.count = 0;
  }

  today() {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  take() {
    const day = this.today();
    if (day !== this.day) {
      this.day = day;
      this.count = 0;
    }
    if (this.limit !== 0 && this.count >= this.limit) return false;
    this.count += 1;
    return true;
  }

  remaining() {
    if (this.today() !== this.day) return this.limit;
    return Math.max(0, this.limit - this.count);
  }
}
