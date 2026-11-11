import { el } from './dom';
import { readJson, removeKey, writeJson } from './storage';

export interface LogSection {
  label: string;
  content: unknown;
  open?: boolean;
}

export interface LogEntry {
  kind: 'http' | 'step' | 'error';
  title: string;
  time?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  sections?: LogSection[];
}

const STORAGE_KEY = 'demo.log';
const MAX_ENTRIES = 200;

let entries: LogEntry[] = [];
let list: HTMLOListElement;
let scrollContainer: HTMLElement;

export function initLog(listElement: HTMLOListElement, container: HTMLElement): void {
  list = listElement;
  scrollContainer = container;
  entries = readJson<LogEntry[]>(STORAGE_KEY) ?? [];
  render();
}

export function addLog(entry: LogEntry): void {
  entries = [...entries, { ...entry, time: entry.time ?? new Date().toLocaleTimeString('en-GB') }].slice(-MAX_ENTRIES);
  writeJson(STORAGE_KEY, entries);
  render();
}

export function clearLog(): void {
  entries = [];
  removeKey(STORAGE_KEY);
  render();
}

function render(): void {
  let callNumber = 0;

  list.replaceChildren(
    ...entries.map((entry) => renderEntry(entry, entry.kind === 'http' ? ++callNumber : null)),
  );

  if (entries.length === 0) {
    list.append(el('li', { class: 'log-empty' }, 'No calls yet.'));
  }

  scrollContainer.scrollTop = scrollContainer.scrollHeight;
}

function renderEntry(entry: LogEntry, callNumber: number | null): HTMLLIElement {
  return el(
    'li',
    { class: `entry entry-${entry.kind}` },
    el(
      'div',
      { class: 'entry-head' },
      el('span', { class: 'entry-time' }, entry.time ?? ''),
      callNumber !== null && el('span', { class: 'badge badge-call' }, `#${callNumber}`),
      el('span', { class: `badge badge-${entry.kind}` }, entry.method ?? entry.kind.toUpperCase()),
      el('span', { class: 'entry-title' }, entry.title),
      entry.status !== undefined &&
        el('span', { class: `badge status-${statusClass(entry.status)}` }, entry.status === 0 ? 'network error' : String(entry.status)),
      entry.durationMs !== undefined && el('span', { class: 'entry-duration' }, `${entry.durationMs} ms`),
    ),
    ...(entry.sections ?? []).map((section) =>
      el('details', { open: section.open ?? true }, el('summary', {}, section.label), el('pre', {}, format(section.content))),
    ),
  );
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) {
    return 'ok';
  }

  return status >= 400 && status < 500 ? 'warn' : 'error';
}

function format(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
}
