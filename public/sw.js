/**
 * 离线缓存。只在「把网页加到主屏幕」这条路上用（原生 App 不注册，见 main.js）。
 *
 * 策略：网络优先，失败回落到缓存。
 * 之所以不做缓存优先 —— 这个 App 更新方式是重新部署网页，
 * 缓存优先会让用户一直跑旧版本；网络优先则在线时永远是最新的，断网照样能用。
 */
const CACHE = 'jizhang-v1.5';

self.addEventListener('install', () => {
  // 新版本立刻进入等待队列的下一轮，不等旧标签页关掉
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => {
          if (hit) return hit;
          // 导航请求断网时回落到首页，交给前端路由处理
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        })
      )
  );
});
