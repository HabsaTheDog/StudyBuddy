import type { AnswerSpec, QuizQuestion } from "./nodes/quizReviewNode.js";

// Read only the public response surface, never Moodle's question definition or
// grading data. Coordinates are relative to the accompanying question image.
export const DRAG_DROP_CONTROLS_JS = String.raw`(node => {
  if (!node.classList.contains('ddimageortext')) return [];
  const suffix = (el, prefix) => [...el.classList].find(c => new RegExp('^' + prefix + '[0-9]+$').test(c))?.slice(prefix.length);
  const origin = node.getBoundingClientRect();
  const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x-origin.x, y: r.y-origin.y, width: r.width, height: r.height }; };
  const inputs = [...node.querySelectorAll('input.placeinput')];
  const controls = inputs.flatMap(input => {
    const place = suffix(input, 'place'), group = suffix(input, 'group');
    const drop = node.querySelector('.dropzone.place' + place + '.group' + group);
    if (!place || !group || !drop || !(input.id || input.name)) return [];
    // Moodle hides a filled drop zone. Its placed draggable occupies the actual
    // position, which need not follow the numeric place order.
    const placed = node.querySelector('.draghome.placed.inplace' + place + '.group' + group);
    const bounds = rect(placed || drop);
    if (bounds.width <= 0 || bounds.height <= 0) return [];
    const seen = new Set();
    const options = [...node.querySelectorAll('.draghome.group' + group + ':not(.dragplaceholder)')].flatMap(item => {
      const value = suffix(item, 'choice');
      if (!value || seen.has(value)) return [];
      seen.add(value);
      return [{ value, text: (item.getAttribute('alt') || item.textContent || '').replace(/\s+/g, ' ').trim(),
        reusable: item.classList.contains('infinite'), bounds: rect(item) }];
    });
    return [{ control_id: input.id || input.name, type: 'dragdrop', place, group,
      value: input.value === '0' ? '' : input.value, disabled: input.disabled || node.classList.contains('qtype_ddimageortext-readonly') || !!node.querySelector('.droparea.readonly'),
      option_text: drop.getAttribute('aria-label') || drop.textContent || '', bounds, options }];
  });
  return controls.length === inputs.length ? controls : [];
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
