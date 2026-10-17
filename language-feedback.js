// Teaching the narrator from inside the game. Double-click a story paragraph or a speech bubble to
// rewrite it; the saved pair (what the model wrote → what the player wrote) is shown to the model in
// the next turns as a wrong/right example (see languageFeedbackRule in narration-rules.js) and the
// turn's saved history is patched so the prompt carries the player's wording. Every finished turn is
// also logged with its full prompt, so the player can export a JSONL fine-tuning set of corrected
// turns from the settings panel.
(() => {
  const STORE_KEY = 'van-gioi-ky.language-feedback.v1';
  const MAX_CORRECTIONS = 80;
  const MAX_TURNS = 30;
  const MAX_REPAIRS = 120;
  const story = document.querySelector('#story');
  const statusNode = document.querySelector('#feedback-status');
  const exportButton = document.querySelector('#export-training');
  const clearButton = document.querySelector('#clear-training');

  function fresh() {
    return { corrections: [], turns: [], systems: [], repairs: [] };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved && Array.isArray(saved.corrections) && Array.isArray(saved.turns)) {
        return { ...fresh(), ...saved, systems: Array.isArray(saved.systems) ? saved.systems : [], repairs: Array.isArray(saved.repairs) ? saved.repairs : [] };
      }
    } catch (error) {
      console.warn('Không đọc được dữ liệu huấn luyện ngôn ngữ đã lưu.', error);
    }
    return fresh();
  }

  let state = load();

  // The system prompt barely changes between turns, so it is stored once and referenced by index.
  function save() {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
        return;
      } catch (error) {
        // Out of room: drop the oldest logged turns (corrections are small and kept) and try again.
        if (!state.turns.length) { console.warn('Không lưu được dữ liệu huấn luyện ngôn ngữ.', error); return; }
        state.turns = state.turns.slice(Math.ceil(state.turns.length / 2));
        compactSystems();
      }
    }
  }

  function compactSystems() {
    const used = new Set(state.turns.map(turn => turn.system));
    const remap = new Map();
    state.systems = state.systems.filter((text, index) => { if (used.has(index)) { remap.set(index, remap.size); return true; } return false; });
    state.turns.forEach(turn => { turn.system = remap.get(turn.system); });
  }

  function render() {
    if (!statusNode) return;
    const parts = [];
    if (state.corrections.length) parts.push(`${state.corrections.length} câu người chơi sửa`);
    if (state.repairs.length) parts.push(`${state.repairs.length} câu máy tự sửa`);
    parts.push(`${state.turns.length} lượt đã ghi`);
    statusNode.textContent = parts.join(' · ');
    statusNode.dataset.state = state.corrections.length || state.turns.length ? 'ready' : 'idle';
    if (exportButton) exportButton.disabled = !state.turns.length && !state.corrections.length;
    if (clearButton) clearButton.disabled = !state.turns.length && !state.corrections.length && !state.repairs.length;
  }

  const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();

  // The last few corrections, newest last, for the prompt.
  function recentCorrections(limit = 6) {
    return state.corrections.slice(-limit).map(({ before, after }) => ({ before, after }));
  }

  function recordTurn({ action, system, user, answer, model }) {
    if (!answer) return;
    let systemIndex = state.systems.indexOf(system);
    if (systemIndex < 0) { state.systems.push(system); systemIndex = state.systems.length - 1; }
    state.turns.push({ at: new Date().toISOString(), model: model || '', action: action || '', system: systemIndex, user: user || '', answer });
    if (state.turns.length > MAX_TURNS) { state.turns = state.turns.slice(-MAX_TURNS); compactSystems(); }
    save();
    render();
  }

  // Automatic rewrites by the model (fixVietnameseWords in ai.js) are kept for the count and the export,
  // but never shown back to the model as examples: only the player's own fixes are trusted that far.
  function recordAutoRepair({ before, after }) {
    if (!normalize(before) || !normalize(after)) return;
    state.repairs.push({ at: new Date().toISOString(), before: normalize(before), after: normalize(after) });
    state.repairs = state.repairs.slice(-MAX_REPAIRS);
    save();
    render();
  }

  function addCorrection(before, after) {
    before = normalize(before);
    after = normalize(after);
    if (!before || !after || before === after) return;
    state.corrections.push({ at: new Date().toISOString(), before, after });
    state.corrections = state.corrections.slice(-MAX_CORRECTIONS);
    // The logged turn that contains the sentence gets the player's wording too, so the export is clean.
    const plainBefore = before.replace(/\*\*/g, '');
    for (let index = state.turns.length - 1; index >= 0; index--) {
      const turn = state.turns[index];
      const plain = turn.answer.replace(/\*\*/g, '');
      if (plain.includes(plainBefore)) { turn.answer = plain.split(plainBefore).join(after); break; }
    }
    window.applyStoryCorrection?.(before, after);
    save();
    render();
  }

  // In-place editing of a rendered paragraph or speech bubble.
  function startEdit(node) {
    const originalHtml = node.innerHTML;
    const before = normalize(node.textContent);
    let cancelled = false;
    // plaintext-only keeps pasted markup out; a browser without it falls back to ordinary editing, and the
    // saved text is read back as plain text either way.
    node.setAttribute('contenteditable', 'plaintext-only');
    if (node.isContentEditable === false) node.setAttribute('contenteditable', 'true');
    node.classList.add('editing');
    node.focus();
    const finish = () => {
      node.removeAttribute('contenteditable');
      node.classList.remove('editing');
      node.removeEventListener('keydown', onKey);
      if (cancelled) { node.innerHTML = originalHtml; return; }
      const after = normalize(node.textContent);
      if (!after) { node.innerHTML = originalHtml; return; }
      if (after !== before) addCorrection(before, after);
    };
    const onKey = event => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); node.blur(); }
      if (event.key === 'Escape') { cancelled = true; node.blur(); }
    };
    node.addEventListener('keydown', onKey);
    node.addEventListener('blur', finish, { once: true });
  }

  story?.addEventListener('dblclick', event => {
    const node = event.target.closest('.narration, dialogue');
    if (!node || node.hasAttribute('contenteditable')) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) selection.removeAllRanges();
    startEdit(node);
  });

  // One JSONL line per logged turn in the chat fine-tuning layout {messages:[system,user,assistant]},
  // followed by the stand-alone corrections and the automatic repairs as {correction:{before,after}} lines.
  function exportTraining() {
    const lines = state.turns.map(turn => JSON.stringify({
      messages: [
        { role: 'system', content: state.systems[turn.system] || '' },
        { role: 'user', content: turn.user },
        { role: 'assistant', content: turn.answer }
      ],
      meta: { at: turn.at, model: turn.model, action: turn.action }
    }));
    state.corrections.forEach(pair => lines.push(JSON.stringify({ correction: { before: pair.before, after: pair.after, by: 'player', at: pair.at } })));
    state.repairs.forEach(pair => lines.push(JSON.stringify({ correction: { before: pair.before, after: pair.after, by: 'model', at: pair.at } })));
    if (!lines.length) return;
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'application/jsonl;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `van-gioi-ky-huan-luyen-${new Date().toISOString().slice(0, 10)}.jsonl`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  exportButton?.addEventListener('click', exportTraining);
  clearButton?.addEventListener('click', () => {
    if (!confirm('Xóa toàn bộ câu đã sửa và các lượt đã ghi để huấn luyện?')) return;
    state = fresh();
    save();
    render();
  });

  window.languageFeedback = { recentCorrections, recordTurn, recordAutoRepair, addCorrection, exportTraining };
  render();
})();
