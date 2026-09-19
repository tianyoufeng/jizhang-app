/**
 * 「自定义时间」的选择面板。
 *
 * 账单页和统计页都要用，所以单独一份 —— 各写一遍的话，
 * 快捷档的算法、日期的校验规则迟早会走成两套。
 */
import { openSheet } from './ui.js';
import {
  today, shiftDay, RANGE_PRESETS, presetRange, rangeLabel, rangeDays, isDateStr, escapeHtml
} from './utils.js';

/**
 * 弹出选择面板。
 *
 * opts.initial   上次选过的区间，有就带出来（连续用同一个区间时不用重选）
 * opts.fallback  没选过时先填什么。调用方一般传「当前正在看的那个周期」，
 *                于是从「9 月」点进自定义，开出来就是 9月1日–9月30日，改两下就行
 *
 * 返回 Promise：确定给 { start, end }，取消 / 点遮罩给 null。
 */
export function pickRange({ initial = null, fallback = null } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const now = today();
    // 兜底：什么都没给就填「近 30 天」，至少是个能看的区间
    const seed = usable(initial) || usable(fallback) || { start: shiftDay(now, -29), end: now };

    const handle = openSheet({
      title: '自定义时间',
      body: `
        <p class="range-cap">快捷选择</p>
        <div class="chip-row" data-role="presets">
          ${RANGE_PRESETS.map((p) => `<button type="button" class="chip" data-preset="${p.id}">${escapeHtml(p.label)}</button>`).join('')}
        </div>
        <div class="range-fields">
          <label class="range-field">
            <span>开始</span>
            <input type="date" data-role="start" max="${now}" value="${seed.start}" />
          </label>
          <span class="range-sep">–</span>
          <label class="range-field">
            <span>结束</span>
            <input type="date" data-role="end" max="${now}" value="${seed.end}" />
          </label>
        </div>
        <p class="range-hint" data-role="hint"></p>`,
      actions: [
        { label: '取消', className: 'btn-outline', onClick: (h) => h.close() },
        {
          label: '看这段',
          className: 'btn-primary',
          onClick: (h) => {
            const r = read();
            if (r.error) return;
            done(r.value);
            h.close();
          }
        }
      ],
      // 点遮罩 / 按返回键关掉也算取消，否则这个 Promise 永远不 settle
      onClose: () => done(null)
    });

    const startEl = handle.body.querySelector('[data-role="start"]');
    const endEl = handle.body.querySelector('[data-role="end"]');
    const hintEl = handle.body.querySelector('[data-role="hint"]');
    const okBtn = handle.el.querySelector('.sheet-actions .btn-primary');

    /** 读两个输入框。合法给 { value }，不合法给 { error } */
    function read() {
      const start = startEl.value;
      const end = endEl.value;
      if (!isDateStr(start) || !isDateStr(end)) return { error: '开始和结束日期都要选' };
      // 顺序反了不偷偷换过来 —— 换掉的话用户以为自己点错了却看不出哪里错
      if (start > end) return { error: '开始日期不能晚于结束日期' };
      // 往后选了也没有账，压回今天，免得白看一段空的
      return { value: { start, end: end > now ? now : end } };
    }

    /** 当前填的正好等于某个快捷档就把它点亮 */
    function activePresetId() {
      const r = read();
      if (r.error) return '';
      const hit = RANGE_PRESETS.find((p) => {
        const pr = presetRange(p, now);
        return pr.start === r.value.start && pr.end === r.value.end;
      });
      return hit ? hit.id : '';
    }

    function sync() {
      const r = read();
      const valid = !r.error;
      if (okBtn) okBtn.disabled = !valid;

      if (!valid) {
        hintEl.textContent = r.error;
        hintEl.classList.add('error');
      } else {
        const days = rangeDays(r.value);
        hintEl.textContent = days > 1
          ? `${rangeLabel(r.value)}　共 ${days} 天`
          : `${rangeLabel(r.value)}（就这一天）`;
        hintEl.classList.remove('error');
      }

      const activeId = activePresetId();
      handle.body.querySelectorAll('[data-preset]').forEach((b) => {
        b.classList.toggle('active', b.dataset.preset === activeId);
      });
    }

    startEl.addEventListener('change', sync);
    endEl.addEventListener('change', sync);

    handle.body.querySelector('[data-role="presets"]').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-preset]');
      if (!btn) return;
      const preset = RANGE_PRESETS.find((p) => p.id === btn.dataset.preset);
      if (!preset) return;
      const r = presetRange(preset, now);
      startEl.value = r.start;
      endEl.value = r.end;
      sync();
    });

    sync();
  });
}

/** 只认填好了的区间，缺一个端点就当没有 */
function usable(range) {
  if (!range) return null;
  const { start, end } = range;
  if (!isDateStr(start) || !isDateStr(end) || start > end) return null;
  return { start, end };
}
