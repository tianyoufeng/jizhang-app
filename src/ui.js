import { escapeHtml } from './utils.js';

/* ---------------- 轻提示 ---------------- */

/**
 * 轻提示。
 * opts.ms           停留多久（默认 2000ms）
 * opts.actionLabel  可选的操作按钮文案，比如「撤销」
 * opts.onAction     点了那个按钮之后干什么
 */
export function toast(message, { ms = 2000, actionLabel = '', onAction = null } = {}) {
  const root = document.getElementById('toastRoot');
  if (!root) return { dismiss() {} };

  const el = document.createElement('div');
  el.className = 'toast';

  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);

  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  };

  if (actionLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      dismiss();
      onAction?.();
    });
    el.appendChild(btn);
  }

  root.appendChild(el);
  timer = setTimeout(dismiss, ms);
  return { dismiss };
}

/* ---------------- 底部弹层 ---------------- */

/**
 * 打开一个从底部滑出的面板。
 * 返回一个带 close() 的句柄，方便在提交后自己关掉。
 *
 * onClose 会在面板关掉时回调一次（不管是点按钮还是点遮罩），
 * 而且保证只回调一次 —— 用它把「关掉了」这个事实转成 Promise 的兜底结果。
 */
export function openSheet({ title = '', body = '', actions = [], onClose = null } = {}) {
  const root = document.getElementById('sheetRoot');
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-grip"></div>
      ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
      <div class="sheet-body"></div>
      ${actions.length ? '<div class="sheet-actions"></div>' : ''}
    </div>`;

  const bodyEl = mask.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else bodyEl.appendChild(body);

  let closed = false;
  const handle = {
    el: mask,
    body: bodyEl,
    close() {
      // 可能被点两次（先点按钮、动画结束前又点到遮罩），只认第一次
      if (closed) return;
      closed = true;
      mask.style.animation = 'fade .15s reverse';
      setTimeout(() => mask.remove(), 140);
      onClose?.();
    }
  };

  if (actions.length) {
    const box = mask.querySelector('.sheet-actions');
    actions.forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn ${a.className || ''}`;
      btn.textContent = a.label;
      if (a.disabled) btn.disabled = true;
      btn.addEventListener('click', () => a.onClick?.(handle));
      box.appendChild(btn);
    });
  }

  mask.addEventListener('click', (e) => {
    if (e.target === mask) handle.close();
  });

  root.appendChild(mask);
  return handle;
}

/* ---------------- 确认框 ---------------- */

export function confirmDialog({
  title = '确认',
  message = '',
  okText = '确定',
  cancelText = '取消',
  danger = false,
  onOk
} = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('dialogRoot');
    const mask = document.createElement('div');
    mask.className = 'dialog-mask';
    mask.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-outline" data-act="cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${escapeHtml(okText)}</button>
        </div>
      </div>`;

    const done = (val) => {
      mask.remove();
      resolve(val);
    };

    mask.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
    mask.querySelector('[data-act="ok"]').addEventListener('click', () => {
      // onOk 同步跑，不经过 await —— 这样它里面触发的浏览器动作
      // （比如弹出选择文件的窗口）仍然算在用户这一次点击里，不会被拦掉
      onOk?.();
      done(true);
    });
    mask.addEventListener('click', (e) => {
      if (e.target === mask) done(false);
    });

    root.appendChild(mask);
  });
}

/** 只做提示，只有一个「知道了」 */
export function alertDialog({ title = '提示', message = '' } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('dialogRoot');
    const mask = document.createElement('div');
    mask.className = 'dialog-mask';
    mask.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-primary" data-act="ok">知道了</button>
        </div>
      </div>`;
    const done = () => {
      mask.remove();
      resolve();
    };
    mask.querySelector('[data-act="ok"]').addEventListener('click', done);
    mask.addEventListener('click', (e) => {
      if (e.target === mask) done();
    });
    root.appendChild(mask);
  });
}
