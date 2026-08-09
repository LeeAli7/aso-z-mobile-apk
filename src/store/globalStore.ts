/**
 * globalStore.ts — крошечный шина событий вне React-дерева.
 *
 * Нужен для связи «UI-экраны агента ↔ cron-раннер в ChatScreen» без
 * прокидывания пропсов: todo/cron изменились → подписчики узнают.
 */
type Listener = () => void;

const listeners: Record<string, Set<Listener>> = {};

function subscribe(key: string, fn: Listener): () => void {
  if (!listeners[key]) listeners[key] = new Set();
  listeners[key].add(fn);
  return () => listeners[key]?.delete(fn);
}

function notify(key: string): void {
  listeners[key]?.forEach((fn) => {
    try {
      fn();
    } catch {
      // не роняем цикл уведомлений
    }
  });
}

export const globalStore = {
  subscribeTodo: (fn: Listener) => subscribe("todo", fn),
  notifyTodoChange: () => notify("todo"),
  subscribeCron: (fn: Listener) => subscribe("cron", fn),
  notifyCronChange: () => notify("cron"),
};