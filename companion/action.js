/* Stick — Action staging.
 *
 * The Action button is NOT "speak with a gesture". It is a director: it asks
 * the planner for a beat sheet of physical scenes, then stages each beat with
 * props, board writing, particles and sound effects, and speaks the line.
 *
 * Each scenario is a separate function so one call never has to carry every
 * prompt. The planner picks a scenario id; the stager builds it.
 *
 * Timing is on ONE performance clock. `play(beat)` stages a single beat after
 * `beat.at` SECONDS; `schedule(beats)` lays every beat on the same timeline so
 * the visuals run on their own clock while the audio plays independently —
 * nothing here ever awaits speech, so a performance never stalls between beats.
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  const SCENARIOS = {
    walk:      { label: 'Walk',        prop: null,        fx: null,        gesture: 'walkTalk' },
    run:       { label: 'Run',         prop: null,        fx: null,        gesture: 'run' },
    dance:     { label: 'Dance',       prop: null,        fx: 'sparkle',   gesture: 'dance' },
    handshake: { label: 'Handshake',   prop: null,        fx: null,        gesture: 'handshake', both: true },
    jump:      { label: 'Jump',        prop: null,        fx: 'dust',      gesture: 'jump' },
    fight:     { label: 'Fight',       prop: null,        fx: 'impact',    gesture: 'fight',     both: true },
    clash:     { label: 'Clash',       prop: null,        fx: 'blood',     gesture: 'fight',     both: true },
    classroom: { label: 'Classroom',   prop: 'board',     fx: null,        gesture: 'point' },
    lecture:   { label: 'Lecture',     prop: 'board',     fx: 'chalk',     gesture: 'point' },
    table:     { label: 'Table talk',  prop: 'table',     fx: null,        gesture: 'walkTalk' },
    family:    { label: 'Family',      prop: 'table',     fx: null,        gesture: 'walkTalk' },
    think:     { label: 'Thinking',    prop: null,        fx: 'thought',   gesture: 'walkThink' },
    present:   { label: 'Presenting',  prop: 'board',     fx: 'chalk',     gesture: 'point' },
    approach:  { label: 'Approach',    prop: null,        fx: null,        gesture: 'walk', duo: true, both: true },
    faceoff:   { label: 'Face off',    prop: null,        fx: 'impact',    gesture: 'walk', duo: true, both: true },
    moonwalk:  { label: 'Moonwalk',    prop: null,        fx: 'sparkle',   gesture: 'moonwalk' },
    sillywalk: { label: 'Silly walk',  prop: null,        fx: null,        gesture: 'walkThink' },
  };

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  /* ------------------------------------------------------------ props */

  // A table drawn in stage coordinates (viewBox 0 0 100 100, floor at y=80).
  function drawTable(layer, x, y, w) {
    const g = el('g', { class: 'stage-prop prop-table', opacity: 0 }, layer);
    const top = y, h = 1.2;
    el('rect', { x: x - w / 2, y: top, width: w, height: h, rx: 0.35, fill: '#8a6b4a' }, g);
    el('rect', { x: x - w / 2, y: top, width: w, height: h * 0.55, rx: 0.3, fill: '#a3825c' }, g);
    for (const dx of [-w * 0.38, w * 0.38]) {
      el('rect', { x: x + dx - 0.35, y: top + h, width: 0.7, height: 80 - top - h, fill: '#6f5539' }, g);
    }
    return g;
  }

  /* ------------------------------------------------------- prop library
     Explainer assets, so a lecture can show an actual rocket / chart / planet
     instead of an empty board. */
  const PROPS = {
    rocket(layer, x, y) {
      const g = el('g', { class: 'stage-prop prop-rocket', opacity: 0 }, layer);
      el('path', { d: `M ${x} ${y - 8} C ${x + 2.6} ${y - 4} ${x + 2.6} ${y + 2} ${x + 1.8} ${y + 4} L ${x - 1.8} ${y + 4} C ${x - 2.6} ${y + 2} ${x - 2.6} ${y - 4} ${x} ${y - 8} Z`, fill: '#e8eaee', stroke: '#9aa0ab', 'stroke-width': 0.22 }, g);
      el('circle', { cx: x, cy: y - 3.4, r: 1, fill: '#3fa9d6', stroke: '#2b7fa5', 'stroke-width': 0.18 }, g);
      el('path', { d: `M ${x - 1.8} ${y + 2} L ${x - 3.4} ${y + 4.6} L ${x - 1.8} ${y + 4.2} Z`, fill: '#c0392b' }, g);
      el('path', { d: `M ${x + 1.8} ${y + 2} L ${x + 3.4} ${y + 4.6} L ${x + 1.8} ${y + 4.2} Z`, fill: '#c0392b' }, g);
      const flame = el('path', { d: `M ${x - 1} ${y + 4} Q ${x} ${y + 8} ${x + 1} ${y + 4} Z`, fill: '#f2a03d', class: 'rocket-flame' }, g);
      flame.style.animationDuration = '0.5s';
      return g;
    },
    planet(layer, x, y, col) {
      const g = el('g', { class: 'stage-prop prop-planet', opacity: 0 }, layer);
      el('circle', { cx: x, cy: y, r: 3.2, fill: col || '#e0873f' }, g);
      el('ellipse', { cx: x, cy: y, rx: 5.2, ry: 1.2, fill: 'none', stroke: (col || '#e0873f'), 'stroke-width': 0.35, opacity: 0.7, class: 'ring' }, g);
      return g;
    },
    chart(layer, x, y) {
      const g = el('g', { class: 'stage-prop prop-chart', opacity: 0 }, layer);
      el('rect', { x: x - 7, y: y - 5, width: 14, height: 10, rx: 0.4, fill: '#fbf8f1', stroke: '#c9c1b0', 'stroke-width': 0.22 }, g);
      const bars = [3.2, 5.4, 4.2, 7.2, 6.1];
      bars.forEach((h, i) => {
        el('rect', { x: x - 6 + i * 2.5, y: y + 4 - h, width: 1.6, height: h, rx: 0.2, fill: ['#3fa9d6', '#f2a03d', '#4f9e6a', '#b5652f', '#8a63a8'][i] }, g);
      });
      return g;
    },
    bulb(layer, x, y) {
      const g = el('g', { class: 'stage-prop prop-bulb', opacity: 0 }, layer);
      el('circle', { cx: x, cy: y, r: 1.9, fill: '#ffe6a3', class: 'ghost-bulb' }, g);
      el('rect', { x: x - 0.6, y: y + 1.8, width: 1.2, height: 0.8, fill: '#9aa0ab' }, g);
      return g;
    },
  };

  function addProp(layer, kind, x, y, opts) {
    const fn = PROPS[kind];
    if (!fn) return null;
    return fn(layer, x, y, opts);
  }

  function writeBoardText(textGroup, x, y, w, h, lines) {
    const words = String(lines || '').split(/\s+/).filter(Boolean).slice(0, 22);
    let row = 0, col = 0;
    const lineH = 3.1, perLine = Math.max(6, Math.floor(w * 0.62));
    for (const word of words) {
      if (col + word.length > perLine) { row++; col = 0; }
      if (row > 3) break;
      const t = el('text', {
        x: x - w / 2 + 2.4 + col * 1.06,
        y: y + 4.2 + row * lineH,
        fill: '#eef3ea', 'font-size': '2.05',
        'font-family': 'Iowan Old Style, Palatino, Georgia, serif', opacity: 0.92,
      }, textGroup);
      t.textContent = word;
      col += word.length + 1;
    }
  }

  // A classroom board: dark slate with a chalk tray, and the beat's words
  // written on it so the board is never just a blank rectangle.
  function drawBoard(layer, x, y, w, h, lines) {
    const g = el('g', { class: 'stage-prop prop-board', opacity: 0 }, layer);
    el('rect', { x: x - w / 2 - 0.5, y: y - 0.5, width: w + 1, height: h + 1, rx: 0.5, fill: '#5b4a35' }, g);
    el('rect', { x: x - w / 2, y: y, width: w, height: h, rx: 0.3, fill: '#28403a' }, g);
    el('rect', { x: x - w / 2, y: y + h + 0.15, width: w, height: 0.55, rx: 0.2, fill: '#7a6244' }, g);

    const text = el('g', { class: 'board-text', opacity: 0 }, g);
    writeBoardText(text, x, y, w, h, lines);
    return { g, text };
  }

  /* ------------------------------------------------------------ effects
     Every effect removes itself with a setTimeout; none of them return a
     promise, so staging never waits for particles to finish. */

  function effectSpray(layer, x, y, colors, n) {
    const g = el('g', { class: 'stage-fx' }, layer);
    for (let i = 0; i < (n || 14); i++) {
      const a = (Math.PI * 2 * i) / (n || 14) + Math.random() * 0.5;
      const r = 1.6 + Math.random() * 3.4;
      const c = el('circle', {
        cx: x, cy: y, r: 0.25 + Math.random() * 0.5,
        fill: colors[i % colors.length], opacity: 0.95,
      }, g);
      c.animate(
        [
          { transform: 'translate(0px,0px)', opacity: 1 },
          { transform: `translate(${Math.cos(a) * r * 9}px,${Math.sin(a) * r * 9 - 2}px)`, opacity: 0 },
        ],
        { duration: 700 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' },
      );
    }
    setTimeout(() => g.remove(), 1400);
    return g;
  }

  // Blood: a directional arc + a pooling puddle, drawn in coordinates where
  // SVG y grows downward, so we lift with negative values.
  function effectBlood(layer, x, y) {
    const g = el('g', { class: 'stage-fx' }, layer);
    for (let i = 0; i < 16; i++) {
      const dx = (Math.random() - 0.3) * 26;
      const dy = 6 + Math.random() * 12;
      const d = el('circle', {
        cx: x, cy: y, r: 0.3 + Math.random() * 0.7, fill: '#8e1220', opacity: 0.95,
      }, g);
      d.animate(
        [
          { transform: 'translate(0px,0px)', opacity: 1 },
          { transform: `translate(${dx}px,${dy}px)`, opacity: 0 },
        ],
        { duration: 800 + Math.random() * 600, easing: 'cubic-bezier(.15,.8,.35,1)', fill: 'forwards' },
      );
    }
    const puddle = el('ellipse', { cx: x, cy: 80, rx: 0, ry: 0, fill: '#8e1220', opacity: 0.85 }, g);
    puddle.animate(
      [
        { rx: 0, ry: 0, opacity: 0.9 },
        { rx: 7, ry: 1.3, opacity: 0.85 },
      ],
      { duration: 1200, easing: 'ease-out', fill: 'forwards' },
    );
    setTimeout(() => g.remove(), 2600);
    return g;
  }

  function effectDust(layer, x) {
    const g = el('g', { class: 'stage-fx' }, layer);
    for (let i = 0; i < 8; i++) {
      const dir = i % 2 ? 1 : -1;
      const c = el('circle', { cx: x, cy: 80, r: 0.8, fill: '#cfc6b4', opacity: 0.7 }, g);
      c.animate(
        [
          { transform: 'translate(0px,0px) scale(1)', opacity: 0.7 },
          { transform: `translate(${dir * (3 + i)}px,-2px) scale(2.2)`, opacity: 0 },
        ],
        { duration: 600 + i * 60, easing: 'ease-out', fill: 'forwards' },
      );
    }
    setTimeout(() => g.remove(), 1200);
    return g;
  }

  /* ------------------------------------------------------------ stager */

  function createStager({ svg, getRig, getPartner, onBubble }) {
    // A staging group that sits just above the background <g> but below the
    // character roots, so props read as scenery and never cover a face.
    let layer = null;

    function ensureLayer() {
      if (layer && layer.parentNode) return layer;
      layer = document.createElementNS(NS, 'g');
      layer.setAttribute('class', 'action-layer');
      const bgGroup = svg.querySelector('g');
      if (bgGroup && bgGroup.nextSibling) svg.insertBefore(layer, bgGroup.nextSibling);
      else svg.appendChild(layer);
      return layer;
    }

    ensureLayer();

    const timers = [];
    let token = 0;
    let performanceStart = 0;   // performance.now() at the top of a performance
    let boardEl = null;         // one board per performance, updated not stacked
    let tableEl = null;         // one table per performance, reused

    const now = () => performance.now();

    // Seconds (the public unit) to whole milliseconds, with a safe default.
    function secondsToMs(v) {
      const s = Number(v);
      if (!isFinite(s) || s <= 0) return 0;
      return Math.round(s * 1000);
    }

    function later(fn, ms) {
      const t = setTimeout(fn, ms);
      timers.push(t);
      return t;
    }

    function dispose() {
      token++;
      timers.forEach(clearTimeout);
      timers.length = 0;
      boardEl = null;
      tableEl = null;
      performanceStart = 0;
      if (layer) {
        if (layer.parentNode) layer.parentNode.removeChild(layer);
        layer = null;
      }
    }

    function clear() {
      dispose();
    }

    function fadeIn(node, ms) {
      if (!node) return;
      if (typeof node.animate === 'function') {
        node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms || 420, fill: 'forwards', easing: 'ease-out' });
      }
      if (typeof node.setAttribute === 'function') node.setAttribute('opacity', '1');
    }

    // Where the board goes is decided from the speaker's head; every later
    // board beat reuses that spot instead of moving the board around.
    function boardIsRight(rig) {
      const hx = (rig && rig.pose && rig.pose.world) ? rig.pose.world.head.x : 50;
      return hx < 50;
    }

    function gestureOf(rig, name) {
      if (rig && typeof rig.gesture === 'function') rig.gesture(name);
    }

    function emotionOf(rig, name) {
      if (rig && typeof rig.setEmotion === 'function') rig.setEmotion(name, { intensity: 1 });
    }

    // getPartner() is null in single mode; never let that break a beat.
    function partnerRig() {
      try {
        return typeof getPartner === 'function' ? (getPartner() || null) : null;
      } catch (err) {
        return null;
      }
    }

    /* The physical move for one beat. Runs from a timer; never awaits. */
    function stageBeat(beat) {
      const my = token;
      const kind = String(beat.scenario || '').toLowerCase();
      const spec = SCENARIOS[kind] || SCENARIOS.walk;
      const rig = beat.rig || (typeof getRig === 'function' ? getRig() : null);
      const host = ensureLayer();
      const line = beat.text || beat.title || '';

      // ---- props
      if (spec.prop === 'board') {
        if (boardEl && boardEl.parentNode) {
          // Reuse the one board for the whole performance: rewrite the chalk,
          // never create a second board and never re-fade the slab.
          const words = el('g', { class: 'board-text', opacity: 0 }, boardEl);
          const older = boardEl.querySelectorAll('.board-text');
          for (const n of older) {
            if (n !== words) n.remove();
          }
          writeBoardText(words, boardEl._x, boardEl._y, boardEl._w, boardEl._h, line);
          later(() => { if (my === token) fadeIn(words, 500); }, 120);
        } else {
          const headX = (rig && rig.pose && rig.pose.world) ? rig.pose.world.head.x : 50;
          const toRight = headX < 50;
          const boardX = toRight ? Math.min(78, headX + 26) : Math.max(22, headX - 26);
          const made = drawBoard(host, boardX, 30, 34, 22, line);
          boardEl = made.g;
          boardEl._x = boardX; boardEl._y = 30; boardEl._w = 34; boardEl._h = 22;
          fadeIn(made.g, 480);
          later(() => { if (my === token) fadeIn(made.text, 700); }, 320);
          if (rig && typeof rig.faceTowards === 'function') rig.faceTowards(boardX);
        }
        gestureOf(rig, 'point');
        // pick an explaining asset that suits what is being taught
        const words = String((beat.text || '') + ' ' + (beat.title || '')).toLowerCase();
        const far = boardIsRight(rig) ? 88 : 12;
        let asset = null;
        if (/rocket|launch|space|orbit|nasa|satellite/.test(words)) asset = addProp(host, 'rocket', far, 52);
        else if (/planet|mars|moon|earth|solar/.test(words)) asset = addProp(host, 'planet', far, 54);
        else if (/data|chart|graph|growth|percent|result/.test(words)) asset = addProp(host, 'chart', far, 58);
        if (asset) later(() => { if (my === token) fadeIn(asset, 500); }, 420);
      } else if (spec.prop === 'table') {
        // One table for the whole performance; a later table beat keeps it.
        if (!tableEl || !tableEl.parentNode) {
          tableEl = drawTable(host, 50, 62, 34);
          fadeIn(tableEl, 420);
        }
      }

      // ---- character performance
      if (rig) {
        if (spec.gesture) gestureOf(rig, spec.gesture);
        if (kind === 'clash' || kind === 'fight' || kind === 'faceoff') emotionOf(rig, 'angry');
        else if (kind === 'dance') emotionOf(rig, 'happy');
        else if (kind === 'think') emotionOf(rig, 'thinking');
      }

      // ---- two-person moves: the partner mirrors the move, never blocks
      if (spec.both || spec.duo) stageDuo(kind, my);

      // ---- effects
      if (spec.fx === 'blood') {
        later(() => { if (my === token) effectBlood(ensureLayer(), 50, 46); }, 260);
      } else if (spec.fx === 'impact') {
        later(() => { if (my === token) effectSpray(ensureLayer(), 50, 44, ['#f2c14e', '#e0533a', '#ffffff'], 12); }, 220);
      } else if (spec.fx === 'sparkle') {
        later(() => { if (my === token) effectSpray(ensureLayer(), 50, 40, ['#f6d365', '#fda085', '#a1c4fd'], 16); }, 400);
      } else if (spec.fx === 'dust') {
        later(() => { if (my === token) effectDust(ensureLayer(), 50); }, 60);
      }

      if (beat.text && onBubble) onBubble(beat.text, null, Math.max(1600, beat.text.length * 60));
    }

    // approach / faceoff / handshake / clash / fight: BOTH figures move.
    function stageDuo(kind, my) {
      const partner = partnerRig();
      if (kind === 'faceoff') {
        later(() => {
          if (my !== token) return;
          effectSpray(ensureLayer(), 50, 44, ['#f2c14e', '#e0533a', '#ffffff'], 10);
        }, 1000);
      }
      if (!partner) return;   // single mode: the speaker carries the beat alone

      if (kind === 'approach') {
        // both walk in and meet in the middle
        later(() => { if (my === token) gestureOf(partner, 'walk'); }, 60);
      } else if (kind === 'faceoff') {
        // both set angry and step in
        emotionOf(partner, 'angry');
        later(() => { if (my === token) gestureOf(partner, 'walk'); }, 60);
      } else if (kind === 'handshake') {
        // both raise the handshake arm, a beat apart so it reads as a meeting
        later(() => { if (my === token) gestureOf(partner, 'handshake'); }, 140);
      } else if (kind === 'clash' || kind === 'fight') {
        emotionOf(partner, 'angry');
        later(() => { if (my === token) gestureOf(partner, 'fight'); }, 140);
      }
    }

    // Queue one beat at an absolute delay from *now*; the timer id lands in
    // `timers`, so clear()/dispose() cancel every pending beat.
    function queue(beat, delay) {
      const my = token;
      return later(() => {
        if (my !== token) return;
        try {
          stageBeat(beat);
        } catch (err) {
          // one broken beat must never stop the rest of the performance
        }
      }, delay);
    }

    /* Stage a single beat. `beat` = { scenario, text, title, at }
       `at` is SECONDS from now; undefined means 0 (backwards compatible). */
    function play(beat) {
      const b = beat || {};
      return queue(b, secondsToMs(b.at));
    }

    /* Lay a whole beat sheet on ONE timeline and return immediately.
       beats = [{ scenario, text, title, at (s), dur (s) }]
       Nothing is awaited: every beat's timer is measured from the same
       performanceStart, so the visuals run on their own clock while the audio
       plays independently. */
    function schedule(beats) {
      const list = Array.isArray(beats) ? beats : (beats ? [beats] : []);
      if (!list.length) return performanceStart;
      const start = now();
      performanceStart = start;
      for (const raw of list) {
        const beat = raw || {};
        const due = start + secondsToMs(beat.at);
        const delay = Math.max(0, Math.round(due - now()));
        queue(beat, delay);
      }
      return performanceStart;
    }

    return { play, schedule, clear, dispose, SCENARIOS, addProp };
  }

  window.StickAction = { createStager, SCENARIOS };
})();
