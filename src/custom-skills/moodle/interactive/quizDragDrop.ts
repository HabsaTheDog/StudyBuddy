import type { AnswerSpec, QuizQuestion } from "./nodes/quizReviewNode.js";

// Read only the public response surface, never Moodle's question definition or
// grading data. Coordinates are relative to the accompanying question image.
export const DRAG_DROP_CONTROLS_JS = String.raw`(node => {
  if (!node.classList.contains('ddimageortext')) return [];
  const suffix = (el, prefix) => [...el.classList].find(c => new RegExp('^' + prefix + '[0-9]+$').test(c))?.slice(prefix.length);
  const origin = node.getBoundingClientRect();
  // Browser layout uses 1/64 CSS-pixel coordinates; normalize subpixel float noise.
  const quantize = value => Math.round(value * 64) / 64;
  const rectangle = (x,y,width,height) => ({x:quantize(x),y:quantize(y),width:quantize(width),height:quantize(height)});
  const rect = el => { const r = el.getBoundingClientRect(); return rectangle(r.x-origin.x,r.y-origin.y,r.width,r.height); };
  const targetRect = (drop, placed) => {
    const visible = rect(drop);
    if (visible.width > 0 && visible.height > 0) return visible;
    if (!placed) return null;
    // Hidden native targets retain their original public CSS geometry. Placed
    // images have different padding/size and must never redefine that target.
    const css = getComputedStyle(drop);
    const pixel = value => /^-?[0-9]+(?:\.[0-9]+)?px$/.test(value) ? Number.parseFloat(value) : NaN;
    let width = pixel(css.width), height = pixel(css.height);
    if (css.boxSizing !== 'border-box') {
      width += pixel(css.paddingLeft) + pixel(css.paddingRight) + pixel(css.borderLeftWidth) + pixel(css.borderRightWidth);
      height += pixel(css.paddingTop) + pixel(css.paddingBottom) + pixel(css.borderTopWidth) + pixel(css.borderBottomWidth);
    }
    if (!(width > 0 && height > 0)) return null;
    const matrix = new DOMMatrixReadOnly((drop.style.transform || css.transform) === 'none' ? undefined : (drop.style.transform || css.transform));
    if (!matrix.is2D || matrix.b !== 0 || matrix.c !== 0 || matrix.a <= 0 || matrix.d <= 0) return null;
    let block = drop.parentElement;
    while (block && getComputedStyle(block).position === 'static' && getComputedStyle(block).transform === 'none') block = block.parentElement;
    const left = pixel(css.left), top = pixel(css.top);
    if (!block || css.position !== 'absolute' || !Number.isFinite(left) || !Number.isFinite(top)) return null;
    const anchor = block.getBoundingClientRect(), blockCss = getComputedStyle(block);
    const scaleX = block.offsetWidth ? anchor.width / block.offsetWidth : 1;
    const scaleY = block.offsetHeight ? anchor.height / block.offsetHeight : 1;
    const transformOrigin = (drop.style.transformOrigin || css.transformOrigin).split(' ').map((value,index) => {
      if (['left','top'].includes(value)) return 0;
      if (value === 'center') return (index ? height : width)/2;
      if (['right','bottom'].includes(value)) return index ? height : width;
      if (/^-?[0-9]+(?:\.[0-9]+)?%$/.test(value)) return Number.parseFloat(value)/100*(index ? height : width);
      return pixel(value);
    });
    if (!transformOrigin.every(Number.isFinite)) return null;
    return rectangle(
      anchor.x-origin.x+(pixel(blockCss.borderLeftWidth)+Math.trunc(left*64)/64+matrix.e+transformOrigin[0]*(1-matrix.a))*scaleX,
      anchor.y-origin.y+(pixel(blockCss.borderTopWidth)+Math.trunc(top*64)/64+matrix.f+transformOrigin[1]*(1-matrix.d))*scaleY,
      width*matrix.a*scaleX,height*matrix.d*scaleY);
  };
  const targetGeometry = drop => {
    const style = drop.style;
    const pixel = value => /^-?[0-9]+(?:\.[0-9]+)?px$/.test(value) ? Number.parseFloat(value) : NaN;
    const left = pixel(style.left), top = pixel(style.top), width = pixel(style.width), height = pixel(style.height);
    if (![left,top,width,height].every(Number.isFinite) || width <= 0 || height <= 0 ||
        getComputedStyle(drop).position !== 'absolute' || !style.transform || !style.transformOrigin) return null;
    let matrix;
    try { matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform); }
    catch { return null; }
    const transform = [matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f];
    if (!matrix.is2D || !transform.every(Number.isFinite)) return null;
    const transform_origin = style.transformOrigin.trim().split(/\s+/).map((value,index) => {
      if (['left','top'].includes(value)) return 0;
      if (value === 'center') return (index ? height : width)/2;
      if (['right','bottom'].includes(value)) return index ? height : width;
      if (/^-?[0-9]+(?:\.[0-9]+)?%$/.test(value)) return Number.parseFloat(value)/100*(index ? height : width);
      return pixel(value);
    });
    if (transform_origin.length !== 2 || !transform_origin.every(Number.isFinite)) return null;
    return {left,top,width,height,transform,transform_origin};
  };
  const sourceUrl = item => {
    const source = item.getAttribute('src') || item.currentSrc;
    if (!source) return null;
    try {
      const url = new URL(source, document.baseURI);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      url.hash = '';
      for (const key of url.searchParams.keys()) {
        if (/(?:access[_-]?token|refresh[_-]?token|sesskey|token|secret|password|passwd|passcode|api[_-]?key|auth|authorization|credential|signature|code|key)/i.test(key)) url.searchParams.set(key, '[REDACTED]');
      }
      return url.href;
    } catch { return null; }
  };
  const inputs = [...node.querySelectorAll('input.placeinput')];
  const controls = inputs.flatMap(input => {
    const place = suffix(input, 'place'), group = suffix(input, 'group');
    const drop = node.querySelector('.dropzone.place' + place + '.group' + group);
    if (!place || !group || !drop || !(input.id || input.name)) return [];
    // Moodle hides a filled drop zone. Its placed draggable occupies the actual
    // position, which need not follow the numeric place order.
    const placed = node.querySelector('.draghome.placed.inplace' + place + '.group' + group);
    const bounds = targetRect(drop, placed);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return [];
    const seen = new Map();
    for (const item of node.querySelectorAll('.draghome.group' + group + ':not(.dragplaceholder)')) {
      const value = suffix(item, 'choice');
      if (!value) continue;
      const choice = {value, text:(item.getAttribute('alt') || item.textContent || '').replace(/\s+/g, ' ').trim(),
        reusable:item.classList.contains('infinite'), image_src:sourceUrl(item), bounds:rect(item)};
      const previous = seen.get(value);
      if (previous && (previous.text !== choice.text || previous.reusable !== choice.reusable || previous.image_src !== choice.image_src)) return [];
      if (!previous || (!item.classList.contains('placed') && !item.classList.contains('beingdragged'))) seen.set(value, choice);
    }
    const options = [...seen.values()].sort((a,b) => Number(a.value)-Number(b.value));
    return [{ control_id: input.id || input.name, type: 'dragdrop', place, group,
      value: input.value === '0' ? '' : input.value, disabled: input.disabled || node.classList.contains('qtype_ddimageortext-readonly') || !!node.querySelector('.droparea.readonly'),
      option_text: drop.getAttribute('aria-label') || drop.textContent || '', target_geometry:targetGeometry(drop), bounds, options }];
  });
  return controls.length === inputs.length ? controls : [];
})`;

/** Moodle creates drop zones after its source images and AMD module initialize.
 * Wait only for the public response surface; an incomplete widget remains blocked. */
export const DRAG_DROP_READY_JS = String.raw`(async () => {
  const roots = [...document.querySelectorAll('.que.ddimageortext')]
    .filter(root => root.querySelector('input.placeinput'));
  if (!roots.length) return;
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (roots.every(root => {
      const controls = (${DRAG_DROP_CONTROLS_JS})(root);
      return controls.length > 0 && controls.every(control => control.options.length > 0);
    })) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
})`;

export function buildDragDropFillJs(question: QuizQuestion, answer: AnswerSpec): string {
  return String.raw`(async () => {
    const root = document.getElementById(${JSON.stringify(question.question_id)});
    const plan = ${JSON.stringify(answer.control_answers ?? [])};
    const fail = reason => JSON.stringify({ filled: false, reason });
    if (!root || !root.classList.contains('ddimageortext')) return fail('dragdrop-question-missing');
    const controls = (${DRAG_DROP_CONTROLS_JS})(root);
    if (!controls.length || controls.some(c => c.disabled) || plan.length !== controls.length || new Set(plan.map(p => p.control_id)).size !== controls.length) return fail('dragdrop-incomplete-plan');
    const used = new Set();
    const actions = [];
    for (const control of controls) {
      const entry = plan.find(p => p.control_id === control.control_id);
      const option = control.options.find(o => o.value === entry?.answer);
      if (!entry || !option) return fail('dragdrop-unknown-choice');
      const key = control.group + ':' + option.value;
      if (!option.reusable && used.has(key)) return fail('dragdrop-choice-reused');
      used.add(key);
      const input = [...root.querySelectorAll('input.placeinput')].find(e => (e.id || e.name) === control.control_id);
      const drop = root.querySelector('.dropzone.place' + control.place + '.group' + control.group);
      actions.push({ control, input, drop, value: option.value });
    }
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const press = async (action, key, keyCode) => {
      action.drop.focus();
      action.drop.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true }));
      // Moodle updates the hidden response synchronously but finishes its visual
      // placement asynchronously. Wait for that handler before another key.
      await pause(50);
      for (let i=0; i<40 && root.querySelector('.beingdragged'); i++) await pause(50);
      return !root.querySelector('.beingdragged');
    };
    // Clear through Moodle's keyboard UI so swaps of non-reusable choices work.
    // The caller has already enforced permission to change existing answers.
    for (const action of actions) {
      if (!await press(action, 'Escape', 27) || !['', '0'].includes(action.input.value)) return fail('dragdrop-clear-not-confirmed');
    }
    for (const action of actions) {
      for (let step=0; action.input.value !== action.value && step <= action.control.options.length; step++) {
        if (!await press(action, 'ArrowRight', 39)) return fail('dragdrop-ui-did-not-settle');
      }
      if (action.input.value !== action.value) return fail('dragdrop-placement-not-confirmed');
    }
    if (actions.some(a => a.input.value !== a.value)) return fail('dragdrop-final-state-mismatch');
    return JSON.stringify({ filled: true, reason: 'filled-dragdrop-keyboard-plan', control: { count: actions.length, types: { dragdrop: actions.length } } });
  })()`;
}
