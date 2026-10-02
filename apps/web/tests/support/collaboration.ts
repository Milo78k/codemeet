import { EventEmitter } from 'node:events';

type TestProvider = EventEmitter & { wsconnected: boolean; destroy(): void };

type Room = {
  value: string;
  listeners: Set<() => void>;
  destroyed: number;
  connections: number;
  owners: number;
  generation: number;
  providers: TestProvider[];
};

const rooms = new Map<string, Room>();
export const roomIds: string[] = [];

function getRoom(roomId: string, starterCode: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      value: starterCode,
      listeners: new Set(),
      destroyed: 0,
      connections: 0,
      owners: 0,
      generation: 0,
      providers: [],
    };
    rooms.set(roomId, room);
  }
  return room;
}

export async function connectCollaborativeQuestion(roomId: string, starterCode: string) {
  roomIds.push(roomId);
  const room = getRoom(roomId, starterCode);
  const provider = new EventEmitter() as TestProvider;
  provider.wsconnected = true;
  provider.destroy = () => {
    room.destroyed += 1;
    provider.wsconnected = false;
  };
  room.providers.push(provider);
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
    async bindModel(model: {
      getValue(): string;
      setValue(value: string): void;
      onDidChangeContent(listener: () => void): { dispose(): void };
    }) {
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
  const room = rooms.get(roomId);
  if (room) {
    room.owners += 1;
    room.generation += 1;
  }
}
export function releaseCollaborativeQuestion(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.owners = Math.max(0, room.owners - 1);
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

export function clearCollaborationTestState() {
  rooms.clear();
  roomIds.splice(0);
}

export function collaborationTestMetrics(roomId: string) {
  const room = rooms.get(roomId);
  return room ? { destroyed: room.destroyed, connections: room.connections } : null;
}

export function setProviderStatus(roomId: string, status: 'connected' | 'disconnected') {
  const room = rooms.get(roomId);
  const provider = room?.providers.at(-1);
  if (provider) provider.wsconnected = status === 'connected';
  provider?.emit('status', { status });
}
