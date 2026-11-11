export function readJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);

    return raw === null ? null : (JSON.parse(raw) as T);
  } catch (error) {
    console.warn(`Cannot read "${key}" from sessionStorage.`, error);

    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Cannot write "${key}" to sessionStorage.`, error);
  }
}

export function removeKey(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch (error) {
    console.warn(`Cannot remove "${key}" from sessionStorage.`, error);
  }
}
