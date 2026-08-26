import Config from 'react-native-config';

export type StreamMessage = {
  key: string;
  data: { msg_type: string; payload: any };
};

type Handler = (m: StreamMessage) => void;

// Minimal shape shared by RN's global WebSocket and the test mock.
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: any }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((e: any) => void) | null;
}

export type WSFactory = (url: string, protocols: string[]) => WebSocketLike;

export type StreamClient = {
  subscribe(tbks: string[], onMessage: Handler): () => void;
};

export function wsUrl(): string {
  const base = Config.MARKETSTORE_BASE_URL!;
  return base.replace(/^http/, 'ws') + '/ws';
}

export function createStreamClient(
  opts: {
    factory?: WSFactory;
    url?: string;
    backoff?: (attempt: number) => number;
  } = {},
): StreamClient {
  const factory: WSFactory =
    opts.factory ??
    ((u, p) => new WebSocket(u, p) as unknown as WebSocketLike);
  const url = opts.url ?? wsUrl();
  const backoff = opts.backoff ?? (a => Math.min(1000 * 2 ** a, 15000));

  const counts = new Map<string, number>(); // tbk -> refcount
  const handlers = new Map<string, Set<Handler>>(); // tbk -> handlers
  let ws: WebSocketLike | null = null;
  let open = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const union = () => Array.from(counts.keys());

  function sendSubscribe() {
    if (ws && open) {
      ws.send(JSON.stringify({ action: 'subscribe', tbks: union() }));
    }
  }

  function connect() {
    if (ws || counts.size === 0) {
      return;
    }
    let socket: WebSocketLike;
    try {
      socket = factory(url, ['json']);
    } catch {
      // Socket creation failed synchronously (e.g. WebSocket ctor threw).
      // Never let it propagate into React — treat it as a dropped connection
      // and reschedule via the existing backoff path. ws stays null.
      onDrop();
      return;
    }
    ws = socket;
    ws.onopen = () => {
      open = true;
      attempt = 0;
      sendSubscribe();
    };
    ws.onmessage = e => {
      let m: StreamMessage;
      try {
        m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      // Ignore subscribe acks / error envelopes (no key).
      if (!m || (m as any).action || !m.key) {
        return;
      }
      handlers.get(m.key)?.forEach(h => h(m));
    };
    ws.onclose = onDrop;
    ws.onerror = onDrop;
  }

  function onDrop() {
    open = false;
    ws = null;
    if (counts.size > 0 && timer == null) {
      timer = setTimeout(() => {
        timer = null;
        connect();
      }, backoff(attempt++));
    }
  }

  function subscribe(tbks: string[], onMessage: Handler): () => void {
    for (const tbk of tbks) {
      counts.set(tbk, (counts.get(tbk) ?? 0) + 1);
      let set = handlers.get(tbk);
      if (!set) {
        set = new Set();
        handlers.set(tbk, set);
      }
      set.add(onMessage);
    }
    connect();
    sendSubscribe();

    let done = false;
    return () => {
      if (done) {
        return; // idempotent: a second off() must not touch the shared refcount
      }
      done = true;
      for (const tbk of tbks) {
        const n = (counts.get(tbk) ?? 1) - 1;
        if (n <= 0) {
          counts.delete(tbk);
        } else {
          counts.set(tbk, n);
        }
        const set = handlers.get(tbk);
        if (set) {
          set.delete(onMessage);
          if (set.size === 0) {
            handlers.delete(tbk);
          }
        }
      }
      sendSubscribe();
    };
  }

  return { subscribe };
}

// Shared singleton for app screens. Inert until the first subscribe().
export const stream = createStreamClient();
