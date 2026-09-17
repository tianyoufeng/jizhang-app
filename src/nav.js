/** 极简页面切换：谁想知道当前在哪一页，就注册一个监听 */

const listeners = new Set();
let current = 'record';

export function currentTab() {
  return current;
}

export function onNavigate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function navigate(tab) {
  if (tab === current) return;
  current = tab;
  listeners.forEach((fn) => fn(tab));
}
