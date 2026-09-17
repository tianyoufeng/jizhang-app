import { escapeHtml } from './utils.js';

/* ---------------- 轻提示 ---------------- */

export function toast(message, ms = 2000) {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* ---------------- 底部弹层 ---------------- */

/**
 * 打开一个从底部滑出的面板。
 * 返回一个带 close() 的句柄，方便在提交后自己关掉。
 */
export function openSheet({ title = '', body = '', actions = [], onMount } = {}) {
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

  const handle = {
    el: mask,
    body: bodyEl,
    close() {
      mask.style.animation = 'fade .15s reverse';
      setTimeout(() => mask.remove(), 140);
    },
    setTitle(t) {
      const h = mask.querySelector('h3');
      if (h) h.textContent = t;
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
      (a.ref || (() => {}))(btn);
    });
  }

  mask.addEventListener('click', (e) => {
    if (e.target === mask) handle.close();
  });

  root.appendChild(mask);
  onMount?.(handle);
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

/* ---------------- 底部选择器 ---------------- */

/** 从一组选项里选一个，返回选中项的值；点外面关掉返回 null */
export function pickOption({ title, options, selected }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const rows = options
      .map((o, i) => {
        const mark = o.value === selected ? '<span class="sr-arrow">✓</span>' : '';
        return `<button type="button" class="set-row" data-i="${i}">
          ${o.emoji ? `<span class="sr-ico">${escapeHtml(o.emoji)}</span>` : ''}
          <span class="sr-main">${escapeHtml(o.label)}${o.sub ? `<span class="sr-sub">${escapeHtml(o.sub)}</span>` : ''}</span>
          ${mark}
        </button>`;
      })
      .join('');

    const handle = openSheet({ title, body: `<div class="set-list">${rows}</div>` });

    handle.body.querySelectorAll('[data-i]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = options[Number(btn.dataset.i)].value;
        finish(value);
        handle.close();
      });
    });

    handle.el.addEventListener('click', (e) => {
      if (e.target === handle.el) finish(null);
    });
  });
}

/* ---------------- 表单字段 ---------------- */

export function field(label, controlHtml) {
  return `<div class="field"><span class="field-label">${escapeHtml(label)}</span>${controlHtml}</div>`;
}
