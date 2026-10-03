import { EventEmitter } from 'node:events';

class TestAwareness extends EventEmitter {
  readonly clientID: number;
  private readonly states = new Map<number, Record<string, unknown>>();

  constructor(clientID: number) {
    super();
    this.clientID = clientID;
  }

  getStates() {
    return this.states;
  }

  getLocalState() {
    return this.states.get(this.clientID) ?? null;
  }

  setLocalStateField(field: string, value: unknown) {
    const state = { ...(this.states.get(this.clientID) ?? {}), [field]: value };
    this.states.set(this.clientID, state);
    this.emit('change', { added: [], updated: [this.clientID], removed: [] });
  }

  setLocalState(state: Record<string, unknown> | null) {
    if (state === null) {
      const removed = this.states.delete(this.clientID) ? [this.clientID] : [];
      this.emit('change', { added: [], updated: [], removed });
      return;
    }
    const added = this.states.has(this.clientID) ? [] : [this.clientID];
    this.states.set(this.clientID, state);
    this.emit('change', { added, updated: added.length ? [] : [this.clientID], removed: [] });
  }

  setRemoteState(clientId: number, state: Record<string, unknown> | null) {
    if (state === null) this.states.delete(clientId);
    else this.states.set(clientId, state);
    this.emit('change', {
      added: state === null ? [] : [clientId],
      updated: [],
      removed: state === null ? [clientId] : [],
    });
  }
}

type TestProvider = EventEmitter & {
  wsconnected: boolean;
  awareness: TestAwareness;
  destroy(): void;
};

type Room = {
  value: string;
  listeners: Set<() => void>;
  destroyed: number;
  connections: number;
  owners: number;
  generation: number;
  providers: TestProvider[];
  awareness: TestAwareness;
  currentProvider?: TestProvider;
};

const rooms = new Map<string, Room>();
const ownerCounts = new Map<string, number>();
let nextClientId = 100;
export const roomIds: string[] = [];

function getRoom(roomId: string, starterCode: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      value: starterCode,
      listeners: new Set(),
      destroyed: 0,
      connections: 0,
      owners: ownerCounts.get(roomId) ?? 0,
      generation: 0,
      providers: [],
      awareness: new TestAwareness(nextClientId++),
    };
    rooms.set(roomId, room);
  }
  return room;
}

export async function connectCollaborativeQuestion(roomId: string, starterCode: string) {
  roomIds.push(roomId);
  const room = getRoom(roomId, starterCode);
  let provider = room.currentProvider;
  if (!provider || !provider.wsconnected) {
    provider = new EventEmitter() as TestProvider;
    provider.wsconnected = true;
    provider.awareness = room.awareness;
    let destroyed = false;
    provider.destroy = () => {
      if (destroyed) return;
      destroyed = true;
      room.destroyed += 1;
      provider!.wsconnected = false;
      room.awareness.setLocalState(null);
    };
    room.currentProvider = provider;
    room.providers.push(provider);
  }
  room.connections += 1;
  let active = true;
  const text = {
    get length() {
      return room.value.length;
    },
    toString: () => room.value,
    observe(listener: () => void) {
      room.listeners.add(listener);
    },
    unobserve(listener: () => void) {
      room.listeners.delete(listener);
    },
    replace(value: string) {
      room.value = value;
      for (const listener of room.listeners) listener();
    },
  };
  const doc = {
    getText: () => text,
    destroy() {
      room.destroyed += 1;
    },
  };
  return {
    doc,
    text,
    provider,
    async bindModel(context: {
      model: {
        getValue(): string;
        setValue(value: string): void;
        onDidChangeContent(listener: () => void): { dispose(): void };
      };
    }) {
      const model = context.model;
      if (model.getValue() !== text.toString()) model.setValue(text.toString());
      const modelSubscription = model.onDidChangeContent(() => {
        if (active && model.getValue() !== text.toString()) text.replace(model.getValue());
      });
      const textListener = () => {
        if (active && model.getValue() !== text.toString()) model.setValue(text.toString());
      };
      text.observe(textListener);
      return () => {
        active = false;
        modelSubscription.dispose();
        text.unobserve(textListener);
      };
    },
    reset() {
      if (!provider.wsconnected) return false;
      text.replace(starterCode);
      return true;
    },
    destroy() {
      provider.destroy();
    },
  };
}

export function retainCollaborativeQuestion(roomId: string) {
  ownerCounts.set(roomId, (ownerCounts.get(roomId) ?? 0) + 1);
  const room = rooms.get(roomId);
  if (room) {
    room.owners += 1;
    room.generation += 1;
  }
}
export function releaseCollaborativeQuestion(roomId: string) {
  const owners = Math.max(0, (ownerCounts.get(roomId) ?? 1) - 1);
  if (owners === 0) ownerCounts.delete(roomId);
  else ownerCounts.set(roomId, owners);
  const room = rooms.get(roomId);
  if (!room) return;
  room.owners = owners;
  const generation = ++room.generation;
  queueMicrotask(() => {
    if (room.owners === 0 && room.generation === generation) {
      for (const provider of room.providers) provider.destroy();
    }
  });
}
export function destroyCollaborationDocuments() {
  for (const room of rooms.values()) {
    for (const provider of room.providers) provider.destroy();
    room.destroyed += 1;
  }
}

export function updateRemoteText(roomId: string, value: string) {
  const room = rooms.get(roomId);
  if (!room) throw new Error(`Room ${roomId} has not been opened.`);
  room.value = value;
  for (const listener of room.listeners) listener();
}

export function setAwarenessState(
  roomId: string,
  clientId: number,
  state: Record<string, unknown> | null,
) {
  const room = rooms.get(roomId);
  if (!room) throw new Error(`Room ${roomId} has not been opened.`);
  room.awareness.setRemoteState(clientId, state);
}

export function awarenessState(roomId: string, clientId?: number) {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  return room.awareness.getStates().get(clientId ?? room.awareness.clientID);
}

export function awarenessListenerCount(roomId: string) {
  return rooms.get(roomId)?.awareness.listenerCount('change') ?? 0;
}

export function clearCollaborationTestState() {
  rooms.clear();
  ownerCounts.clear();
  roomIds.splice(0);
  nextClientId = 100;
}

export function collaborationTestMetrics(roomId: string) {
  const room = rooms.get(roomId);
  return room
    ? {
        destroyed: room.destroyed,
        connections: room.connections,
        providers: room.providers.length,
        awarenessStates: room.awareness.getStates().size,
      }
    : null;
}

export function setProviderStatus(roomId: string, status: 'connected' | 'disconnected') {
  const room = rooms.get(roomId);
  const provider = room?.providers.at(-1);
  if (provider) provider.wsconnected = status === 'connected';
  provider?.emit('status', { status });
}
