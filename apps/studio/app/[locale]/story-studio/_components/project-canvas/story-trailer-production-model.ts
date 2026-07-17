interface SubmissionKeyRecord {
  fingerprintHash: string;
  key: string;
}

const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export interface StorySubmissionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class StoryProductionActionGate {
  private inFlight = false;

  tryAcquire(): boolean {
    if (this.inFlight) return false;
    this.inFlight = true;
    return true;
  }

  release(): void {
    this.inFlight = false;
  }
}

/** Retains an idempotency key with only the request's SHA-256 until confirmation. */
export class StorySubmissionKeyRegistry {
  private readonly records = new Map<string, SubmissionKeyRecord>();

  constructor(
    private readonly namespace = "story-submission",
    private readonly storage: () => StorySubmissionStorage | null = () => null
  ) {}

  async keyFor(slot: string, fingerprint: string, createKey: () => string): Promise<string> {
    const fingerprintHash = await sha256Hex(fingerprint);
    const current = this.records.get(slot) ?? this.read(slot);
    if (current?.fingerprintHash === fingerprintHash) return current.key;
    const key = createKey();
    const next = { fingerprintHash, key };
    this.records.set(slot, next);
    this.write(slot, next);
    return key;
  }

  async confirm(slot: string, fingerprint: string): Promise<void> {
    const fingerprintHash = await sha256Hex(fingerprint);
    const current = this.records.get(slot) ?? this.read(slot);
    if (current?.fingerprintHash === fingerprintHash) {
      this.records.delete(slot);
      this.remove(slot);
    }
  }

  private read(slot: string): SubmissionKeyRecord | null {
    try {
      const raw = this.storage()?.getItem(this.storageKey(slot));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<SubmissionKeyRecord>;
      if (
        typeof parsed.fingerprintHash !== "string" ||
        !SHA_256_HEX_PATTERN.test(parsed.fingerprintHash) ||
        typeof parsed.key !== "string" ||
        parsed.key.length === 0
      ) {
        this.remove(slot);
        return null;
      }
      const record = { fingerprintHash: parsed.fingerprintHash, key: parsed.key };
      this.records.set(slot, record);
      return record;
    } catch {
      this.remove(slot);
      return null;
    }
  }

  private write(slot: string, record: SubmissionKeyRecord): void {
    try {
      this.storage()?.setItem(this.storageKey(slot), JSON.stringify(record));
    } catch {
      // In-memory retention still protects the active page when storage is unavailable.
    }
  }

  private remove(slot: string): void {
    try {
      this.storage()?.removeItem(this.storageKey(slot));
    } catch {
      // Storage may be unavailable in privacy mode; the in-memory record is already cleared.
    }
  }

  private storageKey(slot: string): string {
    return `${this.namespace}:${slot}`;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto SHA-256 is required for Story submission idempotency.");
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
