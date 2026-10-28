/* Stick — Scene & effect library.
 *
 * Seventeen self-contained SVG scenes for the companion stage. Each renderer
 * draws into a caller-supplied <g> in stage coordinates (x 0..100, y 0..100,
 * floor at y=80) and animates with the existing companion.css classes or SVG
 * <animate> nodes, so no new stylesheet rules are required.
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  const PALETTES = {
    light: { ink: '#1a1915', soft: '#75695a', panel: '#fffdf7', line: '#cabfae', warm: '#f2b463', hair: '#5a4632' },
    dark: { ink: '#efeaf7', soft: '#a99fba', panel: '#1c1826', line: '#4a4260', warm: '#ffd79a', hair: '#d3b78e' },
  };
  const pal = opts => PALETTES[opts && opts.theme === 'dark' ? 'dark' : 'light'];

  function fallbackEl(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  // A disembodied stick-figure head: outline, two eye dots and a mouth line.
  function head(add, parent, x, y, r, p) {
    add('circle', { cx: x, cy: y, r: r, fill: p.panel, stroke: p.ink, 'stroke-width': 0.32 }, parent);
    add('circle', { cx: x - r * 0.36, cy: y - r * 0.2, r: r * 0.14, fill: p.ink }, parent);
    add('circle', { cx: x + r * 0.36, cy: y - r * 0.2, r: r * 0.14, fill: p.ink }, parent);
    add('path', {
      d: `M ${x - r * 0.36} ${y + r * 0.42} Q ${x} ${y + r * 0.72} ${x + r * 0.36} ${y + r * 0.42}`,
      fill: 'none', stroke: p.ink, 'stroke-width': 0.26, 'stroke-linecap': 'round',
    }, parent);
  }

  // One flower: stem, two leaves and a swaying petal head ('tree' class).
  function flower(add, parent, x, top, petal, i) {
    add('path', { d: `M ${x} 80 Q ${x - 2.6} ${(80 + top) / 2} ${x} ${top}`, fill: 'none', stroke: '#4f7f4a', 'stroke-width': 0.55, 'stroke-linecap': 'round' }, parent);
    add('ellipse', { cx: x - 2.4, cy: top + 10, rx: 2.4, ry: 0.95, fill: '#5c9a54', opacity: 0.9, transform: `rotate(-24 ${x - 2.4} ${top + 10})` }, parent);
    add('ellipse', { cx: x + 2.4, cy: top + 16, rx: 2.2, ry: 0.85, fill: '#4f8a48', opacity: 0.9, transform: `rotate(22 ${x + 2.4} ${top + 16})` }, parent);
    const placed = add('g', { transform: `translate(${x} ${top})` }, parent);
    const sway = add('g', { class: 'tree' }, placed);
    sway.style.animationDelay = (-i * 0.9) + 's';
    sway.style.animationDuration = (6 + i * 0.5) + 's';
    for (let k = 0; k < 6; k++) {
      add('ellipse', { cx: 0, cy: -2.5, rx: 1.35, ry: 2.3, fill: petal, opacity: 0.95, transform: `rotate(${k * 60})` }, sway);
    }
    add('circle', { cx: 0, cy: 0, r: 1.5, fill: '#f6c76a', stroke: '#c99a3a', 'stroke-width': 0.2 }, sway);
  }

  const renderers = {
    juggler(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts);
      const g = add('g', { class: 'stick-scene scene-juggler' }, container);
      add('path', { d: 'M 42 79 Q 50 38 58 79', fill: 'none', stroke: p.soft, 'stroke-width': 0.3, 'stroke-dasharray': '1.2 1.4', opacity: 0.55 }, g);
      add('line', { x1: 38, y1: 80, x2: 62, y2: 80, stroke: p.line, 'stroke-width': 0.45 }, g);
      add('ellipse', { cx: 50, cy: 80, rx: 6.5, ry: 0.7, fill: p.ink, opacity: 0.08 }, g);
      const balls = [
        { x: 40, dx: -6.5, d: '0s', c: '#e0533a' },
        { x: 50, dx: 0, d: '-0.6s', c: '#3f8fd0' },
        { x: 60, dx: 6.5, d: '-1.2s', c: '#e8b64c' },
      ];
      balls.forEach(b => {
        // start low at the hands, arc well above the head so the juggling reads
        const ball = add('circle', { cx: b.x, cy: 62, r: 2.6, fill: b.c, stroke: p.ink, 'stroke-width': 0.18 }, g);
        add('animateTransform', {
          attributeName: 'transform', type: 'translate',
          values: `0 0; ${b.dx} -16; 0 -34; ${-b.dx} -16; 0 0`,
          keyTimes: '0;0.25;0.5;0.75;1', dur: '1.8s', begin: b.d,
          repeatCount: 'indefinite', calcMode: 'spline',
          keySplines: '0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1',
        }, ball);
      });
    },

    floatingHeads(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts);
      const g = add('g', { class: 'stick-scene scene-heads' }, container);
      const heads = [[34, 42, 4.4], [46, 33, 3.8], [58, 47, 4.8], [68, 36, 4.0], [40, 55, 3.6]];
      heads.forEach((h, i) => {
        const drift = add('g', { class: 'ghost-float' }, g);
        drift.style.animationDelay = (-i * 1.6) + 's';
        drift.style.animationDuration = (7 + i * 0.9) + 's';
        const bob = add('g', {}, drift);
        add('animateTransform', {
          attributeName: 'transform', type: 'translate', values: '0 0; 0 -2.2; 0 0',
          dur: (3.2 + i * 0.5) + 's', begin: (-i * 0.7) + 's', repeatCount: 'indefinite',
        }, bob);
        head(add, bob, h[0], h[1], h[2], p);
      });
    },

    breakingNews(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl;
      const g = add('g', { class: 'stick-scene scene-news' }, container);
      add('rect', { x: 20, y: 65, width: 60, height: 12, rx: 1.2, fill: '#c0392b' }, g);
      add('rect', { x: 20, y: 65, width: 60, height: 12, rx: 1.2, fill: 'none', stroke: '#8e1220', 'stroke-width': 0.4 }, g);
      const live = add('circle', { cx: 25, cy: 71, r: 1.5, fill: '#ffffff' }, g);
      add('animate', { attributeName: 'opacity', values: '1;0.15;1', dur: '1.4s', repeatCount: 'indefinite' }, live);
      add('text', { x: 28.6, y: 72.4, fill: '#ffffff', 'font-size': '2.4', 'font-weight': '700', 'letter-spacing': '0.35', 'font-family': 'Segoe UI, Arial, sans-serif' }, g).textContent = 'LIVE';
      const blocks = [{ x: 41, w: 11, d: '0s' }, { x: 54, w: 9, d: '-0.8s' }, { x: 65, w: 12, d: '-1.6s' }];
      blocks.forEach((b, i) => {
        const r = add('rect', { x: b.x, y: 69, width: b.w, height: 4, rx: 0.5, fill: '#ffffff', opacity: 0.92 }, g);
        add('animateTransform', {
          attributeName: 'transform', type: 'translate', values: '0 0; 2.4 0; 0 0',
          dur: (2.6 + i * 0.5) + 's', begin: b.d, repeatCount: 'indefinite',
        }, r);
        add('animate', { attributeName: 'opacity', values: '0.35;0.95;0.35', dur: (2.2 + i * 0.4) + 's', begin: b.d, repeatCount: 'indefinite' }, r);
      });
    },

    naptime(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts);
      const g = add('g', { class: 'stick-scene scene-naptime' }, container);
      add('circle', { cx: 65, cy: 31, r: 6.4, fill: '#f6f0dc', class: 'sun' }, g);
      add('circle', { cx: 62.6, cy: 29.4, r: 1.1, fill: '#e3d9bd', opacity: 0.8 }, g);
      add('circle', { cx: 67.4, cy: 33.2, r: 0.8, fill: '#e3d9bd', opacity: 0.8 }, g);
      [[27, 33], [40, 27], [54, 25]].forEach(([x, y], i) => {
        const s = add('circle', { cx: x, cy: y, r: 0.55, fill: '#eaf1ff', class: 'star' }, g);
        s.style.animationDelay = (-i * 1.1) + 's';
      });
      add('line', { x1: 22, y1: 80, x2: 78, y2: 80, stroke: p.line, 'stroke-width': 0.4 }, g);
      [[46, 45, 2.8, -0.4], [49.6, 40.4, 3.6, -1.8], [53.4, 36, 4.6, -3.2]].forEach(([x, y, size, delay]) => {
        const t = add('text', { x: x, y: y, fill: p.ink, opacity: 0.85, 'font-size': size, 'font-style': 'italic', 'font-weight': '700', 'font-family': 'Segoe UI, Arial, sans-serif' }, g);
        t.textContent = 'Zzz';
        add('animate', { attributeName: 'y', values: `${y};${y - 7}`, dur: '4.4s', begin: delay + 's', repeatCount: 'indefinite' }, t);
        add('animate', { attributeName: 'opacity', values: '0;0.85;0', dur: '4.4s', begin: delay + 's', repeatCount: 'indefinite' }, t);
      });
    },

    flowchart(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts);
      const g = add('g', { class: 'stick-scene scene-flow' }, container);
      const boxes = [
        { x: 20, label: 'Plan' }, { x: 42, label: 'Build' }, { x: 64, label: 'Ship' },
      ];
      const ring = add('rect', { x: 19.4, y: 49.4, width: 17.2, height: 10.2, rx: 2, fill: 'none', stroke: p.warm, 'stroke-width': 0.7, opacity: 0.95 }, g);
      add('animate', {
        attributeName: 'x', values: '19.4;19.4;41.4;41.4;63.4;63.4;19.4',
        keyTimes: '0;0.08;0.33;0.41;0.66;0.74;1', dur: '6s', repeatCount: 'indefinite',
      }, ring);
      boxes.forEach(b => {
        add('rect', { x: b.x, y: 50, width: 16, height: 9, rx: 1.6, fill: p.panel, stroke: p.line, 'stroke-width': 0.35 }, g);
        add('text', {
          x: b.x + 8, y: 55.6, 'text-anchor': 'middle', fill: p.ink, 'font-size': '2.8',
          'font-family': 'Segoe UI, Arial, sans-serif', 'font-weight': '600',
        }, g).textContent = b.label;
      });
      for (const ax of [36.8, 58.8]) {
        add('line', { x1: ax, y1: 54.5, x2: ax + 4.4, y2: 54.5, stroke: p.soft, 'stroke-width': 0.45 }, g);
        add('path', { d: `M ${ax + 4.7} 54.5 L ${ax + 3.4} 53.8 L ${ax + 3.4} 55.2 Z`, fill: p.soft }, g);
      }
      add('line', { x1: 22, y1: 72, x2: 78, y2: 72, stroke: p.line, 'stroke-width': 0.3, opacity: 0.6 }, g);
    },

    balloons(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts);
      const g = add('g', { class: 'stick-scene scene-balloons' }, container);
      const set = [
        { x: 25, c: '#e0533a', dur: 11, begin: '-1s' },
        { x: 37, c: '#3f8fd0', dur: 14, begin: '-7s' },
        { x: 50, c: '#e8b64c', dur: 12, begin: '-4s' },
        { x: 63, c: '#8a63a8', dur: 15, begin: '-10s' },
        { x: 76, c: '#4f9e6a', dur: 13, begin: '-5.5s' },
      ];
      set.forEach(b => {
        const rise = add('g', {}, g);
        add('animateTransform', {
          attributeName: 'transform', type: 'translate', values: '0 20; 0 -40',
          dur: b.dur + 's', begin: b.begin, repeatCount: 'indefinite',
        }, rise);
        add('animate', { attributeName: 'opacity', values: '0;1;1;0', keyTimes: '0;0.12;0.82;1', dur: b.dur + 's', begin: b.begin, repeatCount: 'indefinite' }, rise);
        const sway = add('g', {}, rise);
        add('animateTransform', {
          attributeName: 'transform', type: 'translate', values: '-1.5 0; 1.5 0; -1.5 0',
          dur: (3.2 + (b.dur % 3)) + 's', repeatCount: 'indefinite',
        }, sway);
        add('ellipse', { cx: b.x, cy: 52, rx: 3.4, ry: 4.2, fill: b.c, stroke: p.ink, 'stroke-width': 0.15 }, sway);
        add('ellipse', { cx: b.x - 1.2, cy: 50.4, rx: 0.8, ry: 1.2, fill: '#ffffff', opacity: 0.45 }, sway);
        add('path', { d: `M ${b.x - 0.9} 55.8 L ${b.x + 0.9} 55.8 L ${b.x} 57.3 Z`, fill: b.c, stroke: p.ink, 'stroke-width': 0.12 }, sway);
        add('path', { d: `M ${b.x} 57.3 Q ${b.x + 1.8} 62.5 ${b.x} 68`, fill: 'none', stroke: p.soft, 'stroke-width': 0.22 }, sway);
      });
    },

    beards(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts);
      const g = add('g', { class: 'stick-scene scene-beards' }, container);
      add('line', { x1: 20, y1: 72, x2: 80, y2: 72, stroke: p.line, 'stroke-width': 0.35 }, g);
      const faces = [
        { x: 30, label: 'short', d: 'M -6.8 3.4 Q -4.8 8.2 0 8.6 Q 4.8 8.2 6.8 3.4 Q 3.9 6.2 0 6.4 Q -3.9 6.2 -6.8 3.4 Z' },
        { x: 50, label: 'full', d: 'M -7.2 1.8 C -8.4 7.4 -4.4 11 0 11 C 4.4 11 8.4 7.4 7.2 1.8 C 5.6 6.3 -5.6 6.3 -7.2 1.8 Z' },
        { x: 70, label: 'goatee', d: 'M -2.2 4.6 Q 0 5.4 2.2 4.6 Q 1.8 9.6 0 10.2 Q -1.8 9.6 -2.2 4.6 Z' },
      ];
      faces.forEach((f, i) => {
        const bob = add('g', {}, g);
        add('animateTransform', { attributeName: 'transform', type: 'translate', values: '0 0; 0 -1; 0 0', dur: '4.6s', begin: (-i * 0.7) + 's', repeatCount: 'indefinite' }, bob);
        const h = add('g', { transform: `translate(${f.x} 45)` }, bob);
        add('circle', { cx: 0, cy: 0, r: 8.2, fill: p.panel, stroke: p.ink, 'stroke-width': 0.45 }, h);
        add('circle', { cx: -2.9, cy: -1.7, r: 0.55, fill: p.ink }, h);
        add('circle', { cx: 2.9, cy: -1.7, r: 0.55, fill: p.ink }, h);
        add('path', { d: f.d, fill: p.hair, opacity: 0.95 }, h);
        add('path', { d: 'M -2.4 3.2 Q 0 4.4 2.4 3.2', fill: 'none', stroke: p.ink, 'stroke-width': 0.28, 'stroke-linecap': 'round' }, h);
        add('text', { x: f.x, y: 66, 'text-anchor': 'middle', fill: p.soft, 'font-size': '2.3', 'font-family': 'Segoe UI, Arial, sans-serif' }, g).textContent = f.label;
      });
    },

    flowers(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts);
      const g = add('g', { class: 'stick-scene scene-flowers' }, container);
      add('line', { x1: 18, y1: 80, x2: 82, y2: 80, stroke: '#6f9e5f', 'stroke-width': 0.6 }, g);
      const blooms = [
        { x: 24, top: 52, c: '#f2b6c6' },
        { x: 37, top: 47, c: '#f6d365' },
        { x: 50, top: 43, c: '#e0533a' },
        { x: 63, top: 47, c: '#b48ad6' },
        { x: 76, top: 52, c: '#f7f1e3' },
      ];
      blooms.forEach((b, i) => flower(add, g, b.x, b.top, b.c, i));
      add('ellipse', { cx: 50, cy: 80, rx: 24, ry: 1.1, fill: '#4f7f4a', opacity: 0.25 }, g);
      add('text', { x: 50, y: 74, 'text-anchor': 'middle', fill: p.soft, 'font-size': '2.2', opacity: 0.85, 'font-family': 'Segoe UI, Arial, sans-serif' }, g).textContent = 'in bloom';
    },

    guidedTour(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts);
      const g = add('g', { class: 'stick-scene scene-tour' }, container);
      add('line', { x1: 18, y1: 80, x2: 82, y2: 80, stroke: p.line, 'stroke-width': 0.4 }, g);
      add('rect', { x: 28, y: 30, width: 28, height: 21, rx: 0.8, fill: '#8a6b4a' }, g);
      add('rect', { x: 30, y: 32, width: 24, height: 17, rx: 0.4, fill: '#f4efe4' }, g);
      add('rect', { x: 31.6, y: 33.6, width: 20.8, height: 13.8, fill: '#dfe9ec' }, g);
      add('circle', { cx: 40.6, cy: 39, r: 2.2, fill: '#f2b463' }, g);
      add('path', { d: 'M 31.6 47.4 L 38 41.4 L 43 45.6 L 48 40.6 L 52.4 47.4 Z', fill: '#6f9e73', opacity: 0.9 }, g);
      const spot = add('path', { d: 'M 42 24 L 31 56 L 55 56 Z', fill: p.warm, opacity: 0.16 }, g);
      add('animate', { attributeName: 'opacity', values: '0.08;0.24;0.08', dur: '5.5s', repeatCount: 'indefinite' }, spot);
      add('rect', { x: 60, y: 38, width: 10, height: 6, rx: 0.4, fill: p.panel, stroke: p.line, 'stroke-width': 0.25 }, g);
      add('line', { x1: 61.6, y1: 40.2, x2: 68.4, y2: 40.2, stroke: p.soft, 'stroke-width': 0.25 }, g);
      add('line', { x1: 61.6, y1: 42, x2: 66.6, y2: 42, stroke: p.soft, 'stroke-width': 0.25 }, g);
      for (const x of [61, 75]) {
        add('line', { x1: x, y1: 80, x2: x, y2: 66, stroke: '#b9a685', 'stroke-width': 0.8 }, g);
        add('circle', { cx: x, cy: 65.3, r: 1.15, fill: '#d8c29a', stroke: '#a08c6a', 'stroke-width': 0.25 }, g);
        add('ellipse', { cx: x, cy: 80, rx: 2.4, ry: 0.7, fill: '#b9a685' }, g);
      }
      add('path', { d: 'M 61 66 Q 68 73 75 66', fill: 'none', stroke: '#a33b3b', 'stroke-width': 0.55 }, g);
      add('path', { d: 'M 61 66 Q 68 73 75 66', fill: 'none', stroke: '#c25a5a', 'stroke-width': 0.25, 'stroke-dasharray': '0.8 0.7' }, g);
    },

    pitch(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts);
      const g = add('g', { class: 'stick-scene scene-pitch' }, container);
      add('rect', { x: 24, y: 32, width: 42, height: 30, rx: 2, fill: p.panel, stroke: p.line, 'stroke-width': 0.45 }, g);
      add('rect', { x: 24, y: 32, width: 42, height: 4.6, rx: 2, fill: p.warm }, g);
      add('rect', { x: 24, y: 34.8, width: 42, height: 1.8, fill: p.warm }, g);
      add('text', { x: 27, y: 35.6, fill: '#3a2a1a', 'font-size': '2.2', 'font-weight': '700', 'letter-spacing': '0.3', 'font-family': 'Segoe UI, Arial, sans-serif' }, g).textContent = 'PITCH';
      [['', 12], ['', 15], ['', 9]].forEach(([, w], i) => {
        add('circle', { cx: 29.6, cy: 43 + i * 4.4, r: 0.75, fill: p.ink }, g);
        add('rect', { x: 31.8, y: 42.2 + i * 4.4, width: w, height: 1.6, rx: 0.6, fill: p.soft, opacity: 0.7 }, g);
      });
      add('line', { x1: 49.6, y1: 58, x2: 63.6, y2: 58, stroke: p.line, 'stroke-width': 0.3 }, g);
      const bars = [{ x: 50.6, h: 5, c: '#3f8fd0' }, { x: 53.6, h: 8, c: '#4f9e6a' }, { x: 56.6, h: 11, c: '#e8b64c' }, { x: 59.6, h: 14, c: '#e0533a' }];
      bars.forEach((b, i) => {
        const r = add('rect', { x: b.x, y: 58, width: 2.5, height: 0.4, rx: 0.4, fill: b.c }, g);
        add('animate', { attributeName: 'height', values: `0.4;${b.h};${b.h}`, keyTimes: '0;0.45;1', dur: '4.2s', begin: (-i * 0.3) + 's', repeatCount: 'indefinite' }, r);
        add('animate', { attributeName: 'y', values: `58;${58 - b.h};${58 - b.h}`, keyTimes: '0;0.45;1', dur: '4.2s', begin: (-i * 0.3) + 's', repeatCount: 'indefinite' }, r);
      });
    },

    sunsetGlow(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts);
      const g = add('g', { class: 'stick-scene scene-sunset' }, container);
      add('rect', { x: 18, y: 66, width: 64, height: 14, fill: '#f2a56a', opacity: 0.32 }, g);
      add('rect', { x: 18, y: 72, width: 64, height: 8, fill: '#e08a52', opacity: 0.4 }, g);
      add('circle', { cx: 50, cy: 71, r: 10.5, fill: '#f6a04d', class: 'sun' }, g);
      add('circle', { cx: 50, cy: 71, r: 7.6, fill: '#fbc27a', opacity: 0.85 }, g);
      add('ellipse', { cx: 50, cy: 76, rx: 13, ry: 1.6, fill: '#ffd79a', opacity: 0.35, class: 'cloud' }, g);
      [[13, 0.26], [17.5, 0.18], [22, 0.11]].forEach(([r, o], i) => {
        const ring = add('circle', { cx: 50, cy: 71, r: r, fill: 'none', stroke: '#f7b267', 'stroke-width': 0.6, opacity: o }, g);
        add('animate', { attributeName: 'r', values: `${r};${r + 2.4};${r}`, dur: (5 + i) + 's', repeatCount: 'indefinite' }, ring);
        add('animate', { attributeName: 'opacity', values: `${o};${o * 0.5};${o}`, dur: (5 + i) + 's', repeatCount: 'indefinite' }, ring);
      });
      add('line', { x1: 18, y1: 72, x2: 82, y2: 72, stroke: '#b96a3a', 'stroke-width': 0.55, opacity: 0.55 }, g);
      for (let i = 0; i < 3; i++) {
        add('ellipse', { cx: 50, cy: 72.6 + i * 1.9, rx: 18 - i * 4, ry: 0.35, fill: p.warm, opacity: 0.35 - i * 0.08 }, g);
      }
    },

    moonwalkGlow(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts), dark = opts && opts.theme === 'dark';
      const g = add('g', { class: 'stick-scene scene-moonwalk' }, container);
      add('rect', { x: -20, y: -20, width: 140, height: 100, fill: dark ? '#0a0d19' : '#2b3450' }, g);
      add('rect', { x: -20, y: 16, width: 140, height: 44, fill: dark ? '#2c2438' : '#514459' }, g);
      add('rect', { x: -20, y: 60, width: 140, height: 20, fill: dark ? '#141220' : '#343b57' }, g);
      for (let r = 0; r < 4; r++) {
        const y = 20 + r * 11;
        add('line', { x1: -20, y1: y, x2: 120, y2: y, stroke: p.ink, opacity: 0.14, 'stroke-width': 0.4 }, g);
        for (let c = 0; c < 12; c++) {
          const x = -26 + c * 13 + (r % 2 ? 6.5 : 0);
          add('line', { x1: x, y1: y, x2: x, y2: y + 11, stroke: p.ink, opacity: 0.14, 'stroke-width': 0.35 }, g);
        }
      }
      // three faint cones of lamplight falling to the street
      [[-23, 21, 0.1], [-14, 13, 0.08], [-6, 7, 0.13]].forEach(([l, r, o], i) => {
        const cone = add('path', { d: `M 71 22 L ${71 + l} 80 L ${71 + r} 80 Z`, fill: p.warm, opacity: o }, g);
        add('animate', { attributeName: 'opacity', values: `${o};${(o * 1.8).toFixed(2)};${o}`, dur: (4.6 + i * 0.7) + 's', repeatCount: 'indefinite' }, cone);
      });
      // one street lamp: post, arm, bulb — and a big halo that breathes
      add('line', { x1: 78, y1: 80, x2: 78, y2: 22, stroke: dark ? '#3d3550' : '#5f5674', 'stroke-width': 1.2 }, g);
      add('path', { d: 'M 78 22 Q 78 16.5 71 16.5', fill: 'none', stroke: dark ? '#3d3550' : '#5f5674', 'stroke-width': 1 }, g);
      add('path', { d: 'M 68.2 16.5 L 73.8 16.5 L 72.8 20.4 L 69.2 20.4 Z', fill: dark ? '#4a4260' : '#6b6278' }, g);
      add('circle', { cx: 71, cy: 21.2, r: 1.6, fill: '#fff6dc' }, g);
      const halo = add('circle', { cx: 71, cy: 21.2, r: 17, fill: p.warm, opacity: 0.34, class: 'ghost-glow' }, g);
      add('animate', { attributeName: 'opacity', values: '0.2;0.46;0.2', dur: '4.2s', repeatCount: 'indefinite' }, halo);
      add('animate', { attributeName: 'r', values: '15.6;17.6;15.6', dur: '4.2s', repeatCount: 'indefinite' }, halo);
      add('circle', { cx: 71, cy: 21.2, r: 9.5, fill: p.warm, opacity: 0.32 }, g);
      add('circle', { cx: 71, cy: 21.2, r: 4.2, fill: '#fff3cf', opacity: 0.85 }, g);
      // puddle reflection: a wide pool with the glow shimmering inside it
      add('ellipse', { cx: 66, cy: 78, rx: 15, ry: 2.6, fill: p.warm, opacity: 0.16 }, g);
      const pool = add('ellipse', { cx: 66, cy: 78, rx: 7.5, ry: 1.3, fill: p.warm, opacity: 0.3 }, g);
      add('animate', { attributeName: 'opacity', values: '0.18;0.42;0.18', dur: '4.2s', repeatCount: 'indefinite' }, pool);
      add('animate', { attributeName: 'rx', values: '6.6;8.6;6.6', dur: '4.2s', repeatCount: 'indefinite' }, pool);
      add('line', { x1: -20, y1: 80, x2: 120, y2: 80, stroke: p.line, 'stroke-width': 0.45 }, g);
    },

    pitchDeck(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts);
      const g = add('g', { class: 'stick-scene scene-deck' }, container);
      add('line', { x1: 10, y1: 76, x2: 90, y2: 76, stroke: p.line, 'stroke-width': 0.4 }, g);
      add('line', { x1: 47, y1: 69, x2: 44, y2: 76, stroke: p.soft, 'stroke-width': 0.6 }, g);
      add('line', { x1: 53, y1: 69, x2: 56, y2: 76, stroke: p.soft, 'stroke-width': 0.6 }, g);
      add('rect', { x: 14, y: 12, width: 72, height: 57, rx: 2.4, fill: p.panel, stroke: p.ink, 'stroke-width': 0.45 }, g);
      add('rect', { x: 14, y: 12, width: 72, height: 8, rx: 2.4, fill: '#3f6fb0' }, g);
      add('rect', { x: 14, y: 17.4, width: 72, height: 2.6, fill: '#3f6fb0' }, g);
      add('text', { x: 17.4, y: 17.6, fill: '#ffffff', 'font-size': '2.9', 'font-weight': '700', 'letter-spacing': '0.4', 'font-family': 'Segoe UI, Arial, sans-serif' }, g).textContent = 'SERIES A · GROWTH';
      // three-item bullet list
      ['Market', 'Traction', 'Team'].forEach((label, i) => {
        add('circle', { cx: 18.8, cy: 28 + i * 6.6, r: 1, fill: '#3f6fb0' }, g);
        add('text', { x: 21.6, y: 29.2 + i * 6.6, fill: p.ink, 'font-size': '3.1', 'font-family': 'Segoe UI, Arial, sans-serif' }, g).textContent = label;
        add('rect', { x: 21.6, y: 31.2 + i * 6.6, width: 15 - i * 2, height: 0.7, rx: 0.35, fill: p.soft, opacity: 0.5 }, g);
      });
      // the chart: axis, grid and five bars that grow
      [50, 42, 34].forEach(y => {
        add('line', { x1: 50, y1: y, x2: 80, y2: y, stroke: p.line, 'stroke-width': 0.2, opacity: 0.45 }, g);
      });
      add('line', { x1: 50, y1: 59, x2: 80, y2: 59, stroke: p.line, 'stroke-width': 0.35 }, g);
      const cols = ['#9dc0e8', '#6f9bd6', '#4a76b8', '#3f6fb0', '#e8b64c'];
      [7, 10, 13, 16, 20].forEach((h, i) => {
        const bar = add('rect', { x: 51.4 + i * 5.6, y: 59, width: 3.6, height: 0.5, rx: 0.5, fill: cols[i] }, g);
        add('animate', { attributeName: 'height', values: `0.5;${h};${h}`, keyTimes: '0;0.5;1', dur: '5s', begin: (-i * 0.32) + 's', repeatCount: 'indefinite' }, bar);
        add('animate', { attributeName: 'y', values: `59;${59 - h};${59 - h}`, keyTimes: '0;0.5;1', dur: '5s', begin: (-i * 0.32) + 's', repeatCount: 'indefinite' }, bar);
      });
      // the Q3 chip, glowing gently
      add('rect', { x: 66.2, y: 61.8, width: 11.6, height: 4.8, rx: 2.4, fill: '#e8b64c' }, g);
      add('text', { x: 72, y: 65.1, 'text-anchor': 'middle', fill: '#3a2a1a', 'font-size': '2.6', 'font-weight': '700', 'font-family': 'Segoe UI, Arial, sans-serif' }, g).textContent = 'Q3';
      const chip = add('rect', { x: 66.2, y: 61.8, width: 11.6, height: 4.8, rx: 2.4, fill: 'none', stroke: '#e8b64c', 'stroke-width': 0.5 }, g);
      add('animate', { attributeName: 'opacity', values: '0.15;0.95;0.15', dur: '2.8s', repeatCount: 'indefinite' }, chip);
      add('animate', { attributeName: 'stroke-width', values: '0.3;1;0.3', dur: '2.8s', repeatCount: 'indefinite' }, chip);
    },

    daydream(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts), dark = opts && opts.theme === 'dark';
      const g = add('g', { class: 'stick-scene scene-daydream' }, container);
      const defs = add('defs', {}, g);
      const band = add('linearGradient', { id: 'stickDayBand', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      add('stop', { offset: '0%', 'stop-color': dark ? '#3b3f6b' : '#e9dcff', 'stop-opacity': 0.75 }, band);
      add('stop', { offset: '100%', 'stop-color': dark ? '#2a3550' : '#ffe6f0', 'stop-opacity': 0.12 }, band);
      add('rect', { x: 4, y: 16, width: 92, height: 44, rx: 8, fill: 'url(#stickDayBand)' }, g);
      // the big translucent cloud of thoughts, drifting, with a bubble tail
      const cloud = add('g', { class: 'cloud' }, g);
      [[37, 42, 12], [50, 35, 14.5], [64, 43, 11], [47, 50, 11.5], [59, 51, 8.5]].forEach(([cx, cy, r]) => {
        add('circle', { cx, cy, r, fill: p.panel, opacity: dark ? 0.24 : 0.55, stroke: p.line, 'stroke-opacity': 0.45, 'stroke-width': 0.3 }, cloud);
      });
      add('circle', { cx: 30, cy: 60, r: 4, fill: p.panel, opacity: dark ? 0.3 : 0.6, stroke: p.line, 'stroke-width': 0.3 }, g);
      add('circle', { cx: 24.4, cy: 65.4, r: 2.4, fill: p.panel, opacity: dark ? 0.3 : 0.6, stroke: p.line, 'stroke-width': 0.28 }, g);
      // four small bubbles drifting up and fading away
      [[32, 58, 2.1], [46, 61, 2.8], [60, 57, 1.9], [70, 62, 2.5]].forEach(([x, y, r], i) => {
        const b = add('circle', { cx: x, cy: y, r, fill: p.panel, stroke: p.soft, 'stroke-width': 0.28, opacity: 0.75 }, g);
        const dur = (7 + i * 1.3) + 's', begin = (-i * 1.9) + 's';
        add('animateTransform', { attributeName: 'transform', type: 'translate', values: '0 0; 2.4 -26', dur, begin, repeatCount: 'indefinite' }, b);
        add('animate', { attributeName: 'opacity', values: '0;0.8;0.8;0', keyTimes: '0;0.16;0.68;1', dur, begin, repeatCount: 'indefinite' }, b);
      });
      // a few sparkles
      [[26, 29, 1.9], [74, 27, 2.2], [63, 62, 1.6], [38, 67, 1.5]].forEach(([x, y, s], i) => {
        const star = add('path', {
          d: `M ${x} ${y - s} L ${x + s * 0.32} ${y - s * 0.32} L ${x + s} ${y} L ${x + s * 0.32} ${y + s * 0.32} L ${x} ${y + s} L ${x - s * 0.32} ${y + s * 0.32} L ${x - s} ${y} L ${x - s * 0.32} ${y - s * 0.32} Z`,
          fill: p.warm, opacity: 0.7,
        }, g);
        add('animate', { attributeName: 'opacity', values: '0.12;0.9;0.12', dur: (3.6 + i * 0.8) + 's', begin: (-i * 1.1) + 's', repeatCount: 'indefinite' }, star);
      });
    },

    galleryTour(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts), dark = opts && opts.theme === 'dark';
      const g = add('g', { class: 'stick-scene scene-gallery' }, container);
      add('rect', { x: -20, y: 12, width: 140, height: 50, fill: dark ? '#241f2e' : '#efe6d6' }, g);
      add('rect', { x: -20, y: 62, width: 140, height: 18, fill: dark ? '#171320' : '#dbcdb6' }, g);
      add('line', { x1: -20, y1: 62, x2: 120, y2: 62, stroke: p.line, 'stroke-width': 0.45 }, g);
      add('line', { x1: -20, y1: 80, x2: 120, y2: 80, stroke: p.line, 'stroke-width': 0.5 }, g);
      const defs = add('defs', {}, g);
      add('path', { id: 'stickTourBeam', d: 'M 0 12 L -12 74 L 12 74 Z', fill: p.warm }, defs);
      // two framed paintings: a little landscape and a little geometry
      add('rect', { x: 20, y: 22, width: 26, height: 20, rx: 0.7, fill: '#8a6b4a' }, g);
      add('rect', { x: 21.6, y: 23.6, width: 22.8, height: 16.8, fill: '#f4efe4' }, g);
      add('rect', { x: 23, y: 25, width: 20, height: 14, fill: '#dfe9ec' }, g);
      add('circle', { cx: 34, cy: 30.6, r: 3, fill: '#f2a56a' }, g);
      add('path', { d: 'M 23 39 L 29.6 33.4 L 35.4 37 L 43 30.6 L 43 39 Z', fill: '#6f9e73', opacity: 0.9 }, g);
      add('rect', { x: 54, y: 22, width: 26, height: 20, rx: 0.7, fill: '#8a6b4a' }, g);
      add('rect', { x: 55.6, y: 23.6, width: 22.8, height: 16.8, fill: '#f4efe4' }, g);
      add('rect', { x: 57, y: 25, width: 20, height: 14, fill: '#e9e2f2' }, g);
      add('path', { d: 'M 57 39 L 64.4 25 L 71.8 39 Z', fill: '#7a6fb0', opacity: 0.85 }, g);
      add('circle', { cx: 72.4, cy: 30.4, r: 2.9, fill: '#e0533a', opacity: 0.9 }, g);
      add('rect', { x: 66.4, y: 33.4, width: 5.2, height: 5.2, fill: '#e8b64c', opacity: 0.9 }, g);
      // small wall labels under the frames
      [33, 67].forEach(cx => {
        add('rect', { x: cx - 5, y: 44.2, width: 10, height: 5, rx: 0.3, fill: p.panel, stroke: p.line, 'stroke-width': 0.25 }, g);
        add('line', { x1: cx - 3.6, y1: 46.1, x2: cx + 3.6, y2: 46.1, stroke: p.soft, 'stroke-width': 0.24 }, g);
        add('line', { x1: cx - 3.6, y1: 47.5, x2: cx + 1.4, y2: 47.5, stroke: p.soft, 'stroke-width': 0.2 }, g);
      });
      // the spotlight cone, slowly sweeping between the two frames
      const beam = add('use', { href: '#stickTourBeam', x: 33, opacity: 0.2 }, g);
      add('animate', { attributeName: 'x', values: '33;33;67;67;33', keyTimes: '0;0.3;0.55;0.8;1', dur: '13s', repeatCount: 'indefinite' }, beam);
      add('animate', { attributeName: 'opacity', values: '0.12;0.26;0.12', dur: '5.5s', repeatCount: 'indefinite' }, beam);
      // brass posts and a sagging velvet rope
      [30, 70].forEach(x => {
        add('line', { x1: x, y1: 80, x2: x, y2: 66, stroke: '#b99a62', 'stroke-width': 0.9 }, g);
        add('circle', { cx: x, cy: 65.2, r: 1.5, fill: '#d8c29a', stroke: '#9b8354', 'stroke-width': 0.25 }, g);
        add('ellipse', { cx: x, cy: 80, rx: 2.8, ry: 0.8, fill: '#b99a62' }, g);
      });
      const ropeShade = add('path', { d: 'M 30 66 Q 50 74 70 66', fill: 'none', stroke: '#8c2f3a', 'stroke-width': 0.75, 'stroke-linecap': 'round' }, g);
      const ropeLight = add('path', { d: 'M 30 66 Q 50 74 70 66', fill: 'none', stroke: '#c05a66', 'stroke-width': 0.28, 'stroke-dasharray': '0.9 0.8' }, g);
      [ropeShade, ropeLight].forEach(rope => {
        add('animate', { attributeName: 'd', values: 'M 30 66 Q 50 74 70 66;M 30 66 Q 50 75.6 70 66;M 30 66 Q 50 74 70 66', dur: '6.5s', repeatCount: 'indefinite' }, rope);
      });
    },

    standupStage(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts), dark = opts && opts.theme === 'dark';
      const g = add('g', { class: 'stick-scene scene-standup' }, container);
      add('rect', { x: -20, y: 8, width: 140, height: 72, fill: dark ? '#241a20' : '#5a3b3c' }, g);
      for (let r = 0; r < 7; r++) {
        const y = 12 + r * 9.5;
        add('line', { x1: -20, y1: y, x2: 120, y2: y, stroke: p.ink, opacity: 0.14, 'stroke-width': 0.35 }, g);
        for (let c = 0; c < 12; c++) {
          const x = -24 + c * 12 + (r % 2 ? 6 : 0);
          add('line', { x1: x, y1: y, x2: x, y2: y + 9.5, stroke: p.ink, opacity: 0.14, 'stroke-width': 0.3 }, g);
        }
      }
      // warm spotlight: a beam from above and a pool on the boards that pulses
      add('path', { d: 'M 50 2 L 22 80 L 78 80 Z', fill: p.warm, opacity: 0.08 }, g);
      const pool = add('ellipse', { cx: 50, cy: 80, rx: 19, ry: 4.4, fill: p.warm, opacity: 0.34 }, g);
      add('animate', { attributeName: 'opacity', values: '0.2;0.44;0.2', dur: '4.6s', repeatCount: 'indefinite' }, pool);
      add('animate', { attributeName: 'rx', values: '17.4;20;17.4', dur: '4.6s', repeatCount: 'indefinite' }, pool);
      add('line', { x1: -20, y1: 80, x2: 120, y2: 80, stroke: p.line, 'stroke-width': 0.5 }, g);
      // microphone on a stand, nodding a little
      add('ellipse', { cx: 44, cy: 80, rx: 3.6, ry: 0.9, fill: '#2c2c30', opacity: 0.9 }, g);
      add('line', { x1: 44, y1: 80, x2: 44, y2: 56, stroke: '#2c2c30', 'stroke-width': 0.7 }, g);
      add('line', { x1: 44, y1: 56, x2: 47.6, y2: 51.4, stroke: '#2c2c30', 'stroke-width': 0.6 }, g);
      const mic = add('g', { transform: 'rotate(-28 47.6 51.4)' }, g);
      add('rect', { x: 46.4, y: 47, width: 2.4, height: 4.4, rx: 1.1, fill: '#3a3a40', stroke: '#1e1e22', 'stroke-width': 0.2 }, mic);
      add('circle', { cx: 47.6, cy: 47.8, r: 1.2, fill: '#b9b9c4', opacity: 0.8 }, mic);
      add('animateTransform', { attributeName: 'transform', type: 'rotate', values: '-28 47.6 51.4;-24.5 47.6 51.4;-28 47.6 51.4', dur: '6s', repeatCount: 'indefinite' }, mic);
      // the stool
      add('ellipse', { cx: 66, cy: 62, rx: 5.4, ry: 1.4, fill: '#8a5a3a', stroke: '#5e3b25', 'stroke-width': 0.3 }, g);
      add('line', { x1: 61.8, y1: 62.4, x2: 60.8, y2: 80, stroke: '#8a5a3a', 'stroke-width': 0.6 }, g);
      add('line', { x1: 70.2, y1: 62.4, x2: 71.2, y2: 80, stroke: '#8a5a3a', 'stroke-width': 0.6 }, g);
      add('line', { x1: 61.2, y1: 74, x2: 70.8, y2: 74, stroke: '#6b452c', 'stroke-width': 0.4 }, g);
    },

    celebrateConfetti(container, el, opts) {
      if (!container) return;
      const add = el || fallbackEl, p = pal(opts);
      const g = add('g', { class: 'stick-scene scene-confetti' }, container);
      // bunting: a sagging cord strung across the top with triangle pennants
      add('path', { d: 'M 6 8 Q 50 26 94 8', fill: 'none', stroke: p.soft, 'stroke-width': 0.5 }, g);
      const flags = ['#e0533a', '#e8b64c', '#3f8fd0', '#4f9e6a', '#8a63a8', '#e07a9a'];
      for (let i = 0; i < 11; i++) {
        const t = i / 10, x = 6 + t * 88, y = 8 + 36 * t * (1 - t);
        const flag = add('g', { class: 'tree' }, g);
        flag.style.animationDelay = (-i * 0.4) + 's';
        add('path', { d: `M ${x - 2.4} ${y} L ${x + 2.4} ${y} L ${x} ${y + 5.6} Z`, fill: flags[i % flags.length] }, flag);
      }
      // eighteen pieces of confetti, each falling at its own speed and spinning
      const cols = ['#e0533a', '#e8b64c', '#3f8fd0', '#4f9e6a', '#8a63a8', '#f6f0dc'];
      for (let i = 0; i < 18; i++) {
        const x = 4 + ((i * 17.3) % 92), dx = ((i % 3) - 1) * 9;
        const dur = 3.6 + (i % 5) * 0.55, begin = (-i * 0.37) + 's', dir = i % 2 ? 1 : -1;
        const fall = add('g', {}, g);
        add('animateTransform', { attributeName: 'transform', type: 'translate', values: `${x} -10; ${x + dx} 88`, dur: dur + 's', begin, repeatCount: 'indefinite' }, fall);
        const spin = add('g', {}, fall);
        add('animateTransform', { attributeName: 'transform', type: 'rotate', values: `0;${360 * dir}`, dur: (dur * 0.55) + 's', begin, repeatCount: 'indefinite' }, spin);
        add('rect', { x: -1.1, y: -2.1, width: 2.2, height: 4.2, rx: 0.3, fill: cols[i % cols.length], opacity: 0.92 }, spin);
      }
    },
  };

  const api = { renderers, list() { return Object.keys(this.renderers); } };
  if (typeof window !== 'undefined') window.StickScenes = api;
})();
