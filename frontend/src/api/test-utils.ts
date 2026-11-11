import { vi } from "vitest";

export function setupMockSessionStorage(): Map<string, string> {
  const storage = new Map<string, string>();
  const mockSessionStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, val: string) => storage.set(key, String(val)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  };
  vi.stubGlobal("window", { sessionStorage: mockSessionStorage });
  return storage;
}
