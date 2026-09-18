import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function isNative() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

/**
 * 把一个文本文件交给用户。
 * 安卓 / iOS：先写到 App 的缓存目录，再调起系统分享面板（微信 / 邮件 / 存到「文件」都行）
 * 电脑浏览器 / iPhone 上的 PWA：直接触发下载
 */
export async function saveTextFile(filename, text, mimeType = 'text/plain') {
  if (isNative()) {
    const written = await Filesystem.writeFile({
      path: filename,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8
    });
    try {
      await Share.share({
        title: filename,
        text: filename,
        url: written.uri,
        dialogTitle: '保存或发送这个文件'
      });
      return { mode: 'share' };
    } catch (err) {
      // 分享面板被系统拦掉（比如 iOS 上找不到能处理这种文件类型的 App）时，
      // 至少把文件留在缓存目录并告诉用户路径，不要让整个导出无声失败
      return { mode: 'share-failed', uri: written.uri, message: err?.message || '' };
    }
  }

  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { mode: 'download' };
}

/** 让用户挑一个文件，返回文件内容文本；取消则返回 null */
export function readTextFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';

    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(val);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      const reader = new FileReader();
      reader.onload = () => finish(String(reader.result));
      reader.onerror = () => finish(null);
      reader.readAsText(file, 'utf-8');
    });

    // 用户点了取消，change 不会触发；窗口重新获得焦点时兜底
    window.addEventListener(
      'focus',
      () => setTimeout(() => {
        if (!input.files?.length) finish(null);
      }, 800),
      { once: true }
    );

    document.body.appendChild(input);
    input.click();
  });
}

/** 文件名里的日期戳：20260917-1432 */
export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
