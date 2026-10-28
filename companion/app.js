/* Stick — Companion Studio. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const STICK = window.STICK;
  const NS = 'http://www.w3.org/2000/svg';
  const API = 'http://127.0.0.1:8765';

  const LOOK = {
    feminine: { hair: 'long', bodyColor: '#e9d9bd', h: 42 },
    masculine: { hair: 'short', bodyColor: '#c3d3e2', h: 46 },
    neutral: { hair: 'none', bodyColor: '#cfe0cf', h: 44 },
  };
  const ACCENTS = ['#b5652f', '#3f7f8c', '#8a63a8', '#4f8a62'];
  const HAND_CURSOR = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'><path d='M9 14V7.5a1.6 1.6 0 0 1 3.2 0V13l.8-.2V5.4a1.6 1.6 0 0 1 3.2 0v7.2l.8.1V6.8a1.6 1.6 0 0 1 3.2 0v7.4l.7.2v-4a1.6 1.6 0 0 1 3.2 0v8.2c0 4.2-3 7.2-7.2 7.2h-3.4c-2.2 0-3.7-1-4.9-2.8L5.4 17.4c-.8-1.2-.3-2.6 1-3.1.9-.4 1.9 0 2.6.7z' fill='%23fffdf9' stroke='%231a1915' stroke-width='1.4' stroke-linejoin='round'/></svg>\") 9 4, pointer";

  const state = {
    mode: 'single', ptab: 'topic',
    speakers: [{ id: 'a', name: 'Ben', presentation: 'masculine', voice: 'Charon', accent: ACCENTS[0] }],
    script: [{ speakerId: 'a', text: 'That is fantastic. I am really happy to hear that.' }],
    rigs: new Map(), views: new Map(), labels: new Map(),
    activeId: null, segments: [], plan: null, history: [],
    segActive: null, segMeta: null,
    voices: [], voiceMeta: {}, busy: false, style: 'ink',
    scene: 'paper', providers: [],
    body: 'full', zoom: 0.45, baseBox: [18, 24, 64, 64],
  };

  /* ------------------------------------------------------------ scenes */

  const SCENES = {
    paper: { theme: 'light', sky: ['#f4f1ea', '#eae4d7'], floor: '#d9cfbf', ink: '#1a1915' },
    dawn: { theme: 'light', sky: ['#fde6d2', '#f4c9a8'], floor: '#d9a07c', ink: '#3a2318', sun: true },
    meadow: { theme: 'light', sky: ['#e2efe2', '#b9d8b8'], floor: '#7fa37c', ink: '#1e3020', trees: true },
    loft: { theme: 'light', sky: ['#f2ece4', '#e4d8c8'], floor: '#b8a48a', ink: '#241f19', window: true },
    dusk: { theme: 'dark', sky: ['#241826', '#0f0a16'], floor: '#3b2c44', ink: '#f4ecf7', stars: true },
    night: { theme: 'dark', sky: ['#0c1524', '#050810'], floor: '#1d2b3f', ink: '#e7eef8', stars: true, moon: true },
    snow: { theme: 'dark', sky: ['#1b2733', '#0e161f'], floor: '#2b3a49', ink: '#eef6ff', snow: true },
    cabin: { theme: 'dark', sky: ['#2a1f1a', '#120c09'], floor: '#3a2a1f', ink: '#f6ead9', cabin: true, snow: true },
    aquarium: { theme: 'dark', sky: ['#0f3b46', '#04161d'], floor: '#0b2a33', ink: '#eaf6f8', tank: true },
    daylight: { theme: 'light', sky: ['#dff2f7', '#bfe6ef'], floor: '#e8dcc0', ink: '#123a44', tank: true },
    garden: { theme: 'light', sky: ['#dff0d8', '#f8f2d8'], floor: '#7fae72', ink: '#1d2a1a', garden: true },
    ghost: { theme: 'dark', sky: ['#1a1226', '#0a0713'], floor: '#241936', ink: '#efeaf7', ghost: true },
    space: { theme: 'dark', sky: ['#0b1230', '#1b0f2e'], floor: '#2a2338', ink: '#f2f4ff', space: true },
    // scene-library entries (rendered by scenes.js)
    juggler:       { theme: 'light', sky: ['#fdf6e8', '#f0e3cb'], floor: '#d9c7a6', ink: '#221c12', lib: 'juggler' },
    heads:         { theme: 'dark',  sky: ['#121a2c', '#060a14'], floor: '#1b2438', ink: '#eef3ff', lib: 'floatingHeads' },
    news:          { theme: 'dark',  sky: ['#0f1622', '#05080d'], floor: '#1a2230', ink: '#f4f7fb', lib: 'breakingNews' },
    naptime:       { theme: 'dark',  sky: ['#101a33', '#050810'], floor: '#1c2740', ink: '#eaf0ff', lib: 'naptime' },
    flowchart:     { theme: 'light', sky: ['#f6f8fb', '#e4eaf3'], floor: '#c9d2df', ink: '#15202e', lib: 'flowchart' },
    balloons:      { theme: 'light', sky: ['#eaf4ff', '#cfe4f7'], floor: '#b9cfe0', ink: '#1a2a38', lib: 'balloons' },
    beards:        { theme: 'light', sky: ['#fbf7f0', '#eee6d8'], floor: '#d6c8b2', ink: '#1f1a12', lib: 'beards' },
    flowers:       { theme: 'light', sky: ['#eef8ec', '#d6ecd4'], floor: '#8fbf88', ink: '#1c2c1a', lib: 'flowers' },
    tour:          { theme: 'light', sky: ['#f7f2e8', '#e8dcc8'], floor: '#c2ae92', ink: '#211a10', lib: 'guidedTour' },
    pitchdeck:     { theme: 'light', sky: ['#f2f5fa', '#dde5f0'], floor: '#c3ccd9', ink: '#141c28', lib: 'pitchDeck' },
    sunsetglow:    { theme: 'dark',  sky: ['#2b1533', '#7a2e21'], floor: '#3a2130', ink: '#ffeede', lib: 'sunsetGlow' },
    moonwalkglow:  { theme: 'dark',  sky: ['#0b0f1c', '#141a2b'], floor: '#232a3d', ink: '#eef3ff', lib: 'moonwalkGlow' },
    daydream:      { theme: 'light', sky: ['#f6f2ff', '#ffe9f2'], floor: '#e2d8f0', ink: '#241d33', lib: 'daydream' },
    gallery:       { theme: 'light', sky: ['#faf7f1', '#ece3d5'], floor: '#cbbb9f', ink: '#221b12', lib: 'galleryTour' },
    standup:       { theme: 'dark',  sky: ['#1a1016', '#0d070a'], floor: '#2a1a20', ink: '#fdf1e6', lib: 'standupStage' },
    confetti:      { theme: 'light', sky: ['#fff8f0', '#ffe6d5'], floor: '#e8cdb8', ink: '#2a1c12', lib: 'celebrateConfetti' },
  };

  const svg = $('stage');
  const bg = document.createElementNS(NS, 'g');
  svg.appendChild(bg);
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };

  function pickScene(text) {
    const t = String(text || '').toLowerCase();
    if (/ghost|haunt|spooky|halloween|flicker|old house|abandon|creepy/.test(t)) return 'ghost';
    if (/rocket|launch|space|nasa|satellite|orbit|astronaut/.test(t)) return 'space';
    if (/fish|tank|aquarium|reef|ocean|sea/.test(t)) {
      return /day|light|sun|bright|white|shallow/.test(t) ? 'daylight' : 'aquarium';
    }
    if (/dog|cat|puppy|kitten|pet|animal|leaf|leaves|green|grass|wind|breeze|meadow|garden|sun/.test(t)) return 'garden';
    if (/cabin|wood|house|cottage|hut|room with windows/.test(t)) return 'cabin';
    if (/snow|winter|ice/.test(t)) return 'snow';
    if (/night|midnight|space|star|dark/.test(t)) return 'night';
    if (/dusk|sunset|evening|purple/.test(t)) return 'dusk';
    if (/forest|tree|garden|nature|meadow/.test(t)) return 'meadow';
    if (/room|loft|office|home|indoor/.test(t)) return 'loft';
    if (/dawn|sunrise|morning|warm/.test(t)) return 'dawn';
    return 'paper';
  }

  function drawSpec(spec) {
    if (!spec || typeof spec !== 'object') { applyScene('paper'); return; }
    const sky = Array.isArray(spec.sky) && spec.sky.length >= 2
      ? spec.sky
      : (spec.theme === 'dark' ? ['#241826', '#0e161f'] : ['#f4f1ea', '#eae4d7']);

    // Pick the figure colour by contrast with the sky, never trusting the model:
    // a generated "ink" can be the same darkness as its own background.
    const parseHex = h => {
      const v = String(h || '').replace('#', '').trim();
      const full = v.length === 3 ? v.split('').map(c => c + c).join('') : v.padEnd(6, '0').slice(0, 6);
      return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0];
    };
    const luma = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const skyLuma = (luma(parseHex(sky[0])) + luma(parseHex(sky[1]))) / 2;
    // light text on dark skies, dark text on light skies
    const wantsLight = skyLuma < 0.55;
    const inkLuma = spec.ink ? luma(parseHex(spec.ink)) : null;
    const inkContrastOk = inkLuma == null
      ? false
      : Math.abs(inkLuma - skyLuma) > 0.42 && (wantsLight ? inkLuma > skyLuma : inkLuma < skyLuma);
    const fallbackInk = wantsLight ? '#f7f6f2' : '#14140f';
    const s = {
      theme: spec.theme === 'dark' ? 'dark' : 'light',
      sky,
      floor: spec.floor || (spec.theme === 'dark' ? '#3b2c44' : '#d9cfbf'),
      ink: inkContrastOk ? spec.ink : fallbackInk,
    };
    state.scene = (spec.name || 'custom').toLowerCase();
    document.body.dataset.theme = s.theme;
    document.body.dataset.scene = state.scene;
    SCENES[state.scene] = SCENES[state.scene] || { theme: s.theme, sky: s.sky, floor: s.floor, ink: s.ink };
    bg.innerHTML = '';
    const defs = el('defs', {}, bg);
    const gGrad = el('linearGradient', { id: 'sky', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': s.sky[0] }, gGrad);
    el('stop', { offset: '100%', 'stop-color': s.sky[1] }, gGrad);
    el('rect', { x: -40, y: -40, width: 180, height: 180, fill: 'url(#sky)' }, bg);

    if (Array.isArray(spec.elements)) {
      for (const e of spec.elements) {
        const type = String(e.type || '').toLowerCase();
        const x = Math.max(-40, Math.min(120, Number(e.x) || 50));
        const y = Math.max(-40, Math.min(120, Number(e.y) || 60));
        const size = Math.max(1, Math.min(30, Number(e.size) || 6));
        const color = e.color || '#888888';
        const opacity = Math.max(0.15, Math.min(1, Number(e.opacity) != null ? Number(e.opacity) : 0.85));
        switch (type) {
          case 'sun':
            el('circle', { cx: x, cy: y, r: size, fill: '#ffd79a', opacity: 0.9, class: 'sun' }, bg);
            el('ellipse', { cx: x, cy: y, rx: size * 2.2, ry: size * 1.5, fill: '#ffd79a', opacity: 0.12, class: 'sun' }, bg);
            break;
          case 'moon':
            el('circle', { cx: x, cy: y, r: size, fill: '#f6f0dc', opacity: 0.9, class: 'sun' }, bg);
            break;
          case 'star':
            for (let i = 0; i < 12; i++) {
              const cx = ((i * 37.7 + x) % 96 + 2);
              const cy = ((i * 19.3 + y / 3) % 50 + 4);
              el('circle', { cx: cx, cy: cy, r: 0.12 + (i % 3) * 0.06, fill: '#eaf1ff', class: 'star', opacity: 0.7 }, bg);
            }
            break;
          case 'cloud':
            el('ellipse', { cx: x, cy: y, rx: size * 2, ry: size * 0.9, fill: color, opacity, class: 'cloud' }, bg);
            break;
          case 'hill':
            el('path', { d: `M ${x - size * 3} 80 Q ${x} ${80 - size * 2.5} ${x + size * 3} 80 Z`, fill: color, opacity, class: 'hill' }, bg);
            break;
          case 'tree':
            el('path', { d: `M ${x} 80 L ${x - size} 80 L ${x} ${80 - size * 3} L ${x + size} 80 Z`, fill: color, opacity, class: 'tree' }, bg);
            break;
          case 'house':
            el('rect', { x: x - size, y: y - size * 1.2, width: size * 2, height: size * 1.5, fill: color, opacity }, bg);
            el('path', { d: `M ${x - size} ${y - size * 1.2} L ${x} ${y - size * 2.2} L ${x + size} ${y - size * 1.2} Z`, fill: '#1a1915', opacity: 0.7 }, bg);
            break;
          case 'window':
            el('rect', { x: x - size / 2, y: y - size / 2, width: size, height: size, fill: '#d6e6ef', opacity: 0.9 }, bg);
            break;
          case 'animal':
            el('ellipse', { cx: x, cy: y + 2, rx: size * 0.8, ry: size * 0.5, fill: color, opacity }, bg);
            el('circle', { cx: x + size * 0.7, cy: y - size * 0.2, r: size * 0.35, fill: color, opacity }, bg);
            break;
          case 'fish':
            el('path', { d: `M ${x - size} ${y} Q ${x - size * 0.5} ${y - size * 0.6} ${x} ${y} Q ${x - size * 0.5} ${y + size * 0.6} ${x - size} ${y} Z`, fill: color, opacity }, bg);
            break;
          case 'bubble':
            el('circle', { cx: x, cy: y, r: size * 0.5, fill: '#dff3f7', opacity: opacity * 0.8, class: 'tank-bubble' }, bg);
            break;
          case 'weed':
            el('path', { d: `M ${x} 80 Q ${x - size} 80 - size ${x} ${80 - size * 2.5} Q ${x + size} 80 ${x} 80 Z`, fill: '#2f7d5e', opacity, class: 'tank-weed' }, bg);
            break;
          case 'snow':
            for (let i = 0; i < 8; i++) {
              const cx = x + (i - 3.5) * size * 0.7;
              const cy = y + (i % 3 - 1) * size * 0.6;
              el('circle', { cx, cy, r: size * 0.15, fill: '#ffffff', opacity: 0.85, class: 'flake' }, bg);
            }
            break;
          case 'rain':
            for (let i = 0; i < 6; i++) {
              el('line', { x1: x + (i - 2.5) * size, y1: y, x2: x + (i - 2.5) * size + 1, y2: y + size * 2, stroke: '#9ecae0', 'stroke-width': 0.3, opacity: opacity * 0.7 }, bg);
            }
            break;
          case 'grass':
            for (let i = -1; i <= 1; i++) {
              el('path', { d: `M ${x + i * size * 0.4} 82 L ${x + i * size * 0.4 - 1.5} 82 L ${x + i * size * 0.4} ${82 - size * 0.8} L ${x + i * size * 0.4 + 1.5} 82 Z`, fill: '#4f7f4a', opacity }, bg);
            }
            break;
          case 'water':
            el('ellipse', { cx: x, cy: y, rx: size * 2.5, ry: size * 0.7, fill: '#6ab3d3', opacity: opacity * 0.7 }, bg);
            break;
        }
      }
    }

    if (s.theme === 'dark' && !spec.stars && !spec.moon && !spec.sun) {
      for (let i = 0; i < 20; i++) {
        const cx = ((i * 37.7) % 96 + 2);
        const cy = ((i * 19.3) % 50 + 4);
        el('circle', { cx: cx, cy: cy, r: 0.12 + (i % 3) * 0.06, fill: '#eaf1ff', class: 'star', opacity: 0.7 }, bg);
      }
    }

    el('line', { x1: -20, y1: 80, x2: 120, y2: 80, stroke: s.floor, 'stroke-width': 0.4 }, bg);
    svg.style.setProperty('--paper', s.sky[0]);
    document.documentElement.style.setProperty('--stage-bg', s.sky[0]);
    if (state.rigs.size) layout();
    document.querySelectorAll('#bgPresets button').forEach(b => b.classList.toggle('on', b.dataset.scene === state.scene));
  }

  function applyScene(name, prompt) {
    const key = prompt ? pickScene(prompt) : (SCENES[name] ? name : pickScene(name));
    const s = SCENES[key];
    state.scene = key;
    document.body.dataset.theme = s.theme;
    document.body.dataset.scene = key;
    bg.innerHTML = '';
    const defs = el('defs', {}, bg);
    const g = el('linearGradient', { id: 'sky', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': s.sky[0] }, g);
    el('stop', { offset: '100%', 'stop-color': s.sky[1] }, g);
    el('rect', { x: -40, y: -40, width: 180, height: 180, fill: 'url(#sky)' }, bg);

    // Extra scene library (juggler, floating heads, news, naptime, flowchart,
    // balloons, beards, flowers, guided tour, pitch, sunset glow).
    if (s.lib && window.StickScenes && window.StickScenes.renderers[s.lib]) {
      try {
        window.StickScenes.renderers[s.lib](bg, el, { theme: s.theme, width: 100, height: 100 });
      } catch (e) {
        log('error', 'scene "' + s.lib + '" failed: ' + e.message);
      }
    }

    if (s.stars) {
      for (let i = 0; i < 30; i++) {
        const c = el('circle', {
          cx: ((i * 37.7) % 96 + 2).toFixed(1), cy: ((i * 19.3) % 50 + 4).toFixed(1),
          r: (0.14 + (i % 3) * 0.08).toFixed(2), fill: '#eaf1ff', class: 'star',
        }, bg);
        c.style.animationDelay = ((i % 7) * 0.6).toFixed(1) + 's';
      }
    }
    if (s.moon) el('circle', { cx: 78, cy: 15, r: 4, fill: '#f6f0dc', opacity: 0.9, class: 'sun' }, bg);
    if (s.sun) {
      el('circle', { cx: 74, cy: 24, r: 8, fill: '#ffd79a', opacity: 0.9, class: 'sun' }, bg);
      el('ellipse', { cx: 74, cy: 24, rx: 18, ry: 12, fill: '#ffd79a', opacity: 0.12, class: 'sun' }, bg);
    }
    if (s.trees) {
      for (let i = 0; i < 7; i++) {
        const x = 5 + i * 15, h = 16 + (i % 3) * 5;
        el('path', {
          d: `M ${x} 80 L ${x - 6} 80 L ${x} ${80 - h} L ${x + 6} 80 Z`,
          fill: '#4d7350', opacity: 0.85, class: 'tree',
        }, bg).style.animationDelay = (i * 0.4).toFixed(1) + 's';
      }
    }
    if (s.window) {
      el('rect', { x: 12, y: 12, width: 24, height: 24, fill: '#d6e6ef', opacity: 0.9 }, bg);
      el('line', { x1: 24, y1: 12, x2: 24, y2: 36, stroke: '#b9a78d', 'stroke-width': 0.5 }, bg);
    }
    if (s.snow) {
      for (let i = 0; i < 26; i++) {
        const f = el('circle', {
          cx: ((i * 31.7) % 96 + 2).toFixed(1), cy: ((i * 17.9) % 60 + 4).toFixed(1),
          r: 0.32, fill: '#ffffff', opacity: 0.85, class: 'flake',
        }, bg);
        f.style.animationDelay = ((i % 9) * -1.5).toFixed(1) + 's';
        f.style.animationDuration = (10 + (i % 5) * 2) + 's';
      }
    }

    if (s.space) {
      // launch scene: starfield, a gantry tower, a rocket on the pad, exhaust
      for (let i = 0; i < 34; i++) {
        el('circle', {
          cx: ((i * 29.3) % 96 + 2).toFixed(1), cy: ((i * 13.7) % 54 + 3).toFixed(1),
          r: (0.1 + (i % 3) * 0.07).toFixed(2), fill: '#dfe7ff',
          opacity: 0.75, class: 'star',
        }, bg);
      }
      // ground
      el('rect', { x: -10, y: 74, width: 120, height: 12, fill: '#241d30' }, bg);
      // gantry tower
      for (let i = 0; i < 5; i++) {
        el('line', { x1: 30, y1: 74 - i * 7, x2: 38, y2: 74 - i * 7, stroke: '#4a4260', 'stroke-width': 0.35 }, bg);
        el('line', { x1: 30, y1: 74 - i * 7, x2: 30, y2: 74 - (i + 1) * 7, stroke: '#4a4260', 'stroke-width': 0.35 }, bg);
        el('line', { x1: 38, y1: 74 - i * 7, x2: 37, y2: 74 - (i + 1) * 7, stroke: '#4a4260', 'stroke-width': 0.35 }, bg);
      }
      // rocket
      const rx = 60;
      el('path', {
        d: `M ${rx} 26 C ${rx + 5} 36 ${rx + 5} 56 ${rx + 4} 64 L ${rx - 4} 64 C ${rx - 5} 56 ${rx - 5} 36 ${rx} 26 Z`,
        fill: '#eef1f7', stroke: '#b9c0cf', 'stroke-width': 0.3,
      }, bg);
      el('circle', { cx: rx, cy: 42, r: 3, fill: '#3fa9d6', stroke: '#2b7fa5', 'stroke-width': 0.25 }, bg);
      el('path', { d: `M ${rx - 4} 58 L ${rx - 9} 68 L ${rx - 4} 66 Z`, fill: '#c0392b' }, bg);
      el('path', { d: `M ${rx + 4} 58 L ${rx + 9} 68 L ${rx + 4} 66 Z`, fill: '#c0392b' }, bg);
      const flame = el('path', {
        d: `M ${rx - 3.2} 64 Q ${rx} 80 ${rx + 3.2} 64 Z`,
        fill: '#f2a03d', opacity: 0.95, class: 'rocket-flame',
      }, bg);
      flame.style.animationDuration = '0.45s';
      // smoke puffs at the pad
      for (let i = 0; i < 6; i++) {
        el('circle', {
          cx: rx - 14 + i * 6, cy: 72 + (i % 2) * 2, r: 2.4 + (i % 3),
          fill: '#c9c3d6', opacity: 0.18, class: 'cloud',
        }, bg).style.animationDuration = (9 + i * 2) + 's';
      }
    }

    if (s.ghost) {
      // Haunted house: dark rooms, a flickering bulb string, drifting ghosts.
      el('rect', { x: -10, y: 14, width: 120, height: 66, fill: '#191222' }, bg);
      for (let i = 0; i < 9; i++) {
        el('line', { x1: -10, y1: 18 + i * 7, x2: 110, y2: 18 + i * 7, stroke: '#241936', 'stroke-width': 0.5 }, bg);
      }
      el('path', { d: 'M 2 18 L 50 0 L 98 18 Z', fill: '#120d1c' }, bg);

      // windows with a faint warm glow
      for (const [wx, wy, ww, wh, op] of [[14, 26, 22, 20, 0.5], [62, 28, 20, 18, 0.35]]) {
        el('rect', { x: wx, y: wy, width: ww, height: wh, fill: '#f2b463', opacity: op, class: 'ghost-window' }, bg);
        el('line', { x1: wx + ww / 2, y1: wy, x2: wx + ww / 2, y2: wy + wh, stroke: '#191222', 'stroke-width': 0.6 }, bg);
        el('line', { x1: wx, y1: wy + wh / 2, x2: wx + ww, y2: wy + wh / 2, stroke: '#191222', 'stroke-width': 0.6 }, bg);
      }

      // string of bulbs across the top — each flickers on its own rhythm
      el('path', { d: 'M 4 12 Q 30 18 50 13 Q 72 18 96 12', fill: 'none', stroke: '#3a2c4d', 'stroke-width': 0.35 }, bg);
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const bx = 4 + t * 92;
        const by = 12 + Math.sin(t * Math.PI) * 5.2;
        const hue = ['#ffd27a', '#ff9d5c', '#9de0ff', '#ffb3e6'][i % 4];
        const bulb = el('circle', { cx: bx, cy: by + 0.9, r: 0.85, fill: hue, class: 'ghost-bulb' }, bg);
        bulb.style.animationDelay = (i * 0.37).toFixed(2) + 's';
        bulb.style.animationDuration = (1.6 + (i % 4) * 0.55).toFixed(2) + 's';
        el('circle', { cx: bx, cy: by + 0.9, r: 2.3, fill: hue, opacity: 0.14, class: 'ghost-glow' }, bg)
          .style.animationDelay = (i * 0.37).toFixed(2) + 's';
      }

      // ghosts drifting through the room
      for (let i = 0; i < 3; i++) {
        const g = el('g', { class: 'ghost-float', opacity: 0.5,
          transform: `translate(${24 + i * 26} ${34 + i * 10}) scale(${1 + i * 0.25})` }, bg);
        g.style.animationDelay = (-i * 2.4).toFixed(1) + 's';
        g.style.animationDuration = (7 + i * 2.5).toFixed(1) + 's';
        el('path', {
          d: 'M 0 0 C -3.4 -1.2 -3.4 -5.2 0 -5.6 C 3.4 -5.2 3.4 -1.2 0 0 Z',
          fill: '#e9e4f5', opacity: 0.85,
        }, g);
        el('circle', { cx: -1.1, cy: -3.4, r: 0.42, fill: '#241936' }, g);
        el('circle', { cx: 1.1, cy: -3.4, r: 0.42, fill: '#241936' }, g);
      }

      // cobweb in the corner
      el('path', { d: 'M 2 18 L 2 30 M 2 18 L 14 18 M 2 18 L 11 27', stroke: '#5b4a72', 'stroke-width': 0.22, fill: 'none', opacity: 0.7 }, bg);
    }

    if (s.cabin) {
      el('rect', { x: -10, y: 18, width: 120, height: 62, fill: '#3b2a1f' }, bg);
      for (let i = 0; i < 9; i++) {
        el('line', { x1: -10, y1: 22 + i * 7, x2: 110, y2: 22 + i * 7, stroke: '#241812', 'stroke-width': 0.5 }, bg);
      }
      el('rect', { x: 14, y: 30, width: 26, height: 22, fill: '#f6c877', opacity: 0.85 }, bg);
      el('rect', { x: 60, y: 32, width: 22, height: 20, fill: '#f6c877', opacity: 0.7 }, bg);
      el('line', { x1: 27, y1: 30, x2: 27, y2: 52, stroke: '#241812', 'stroke-width': 0.6 }, bg);
      el('line', { x1: 14, y1: 41, x2: 40, y2: 41, stroke: '#241812', 'stroke-width': 0.6 }, bg);
      el('path', { d: 'M 2 22 L 50 4 L 98 22 Z', fill: '#1d1410' }, bg);
      for (const [x, y, sc] of [[44, 74, 1], [74, 72, 0.8]]) {
        const dog = el('g', { class: 'cloud', transform: `translate(${x} ${y}) scale(${sc})` }, bg);
        el('path', { d: 'M 0 0 l 6 0 l 1 -3 l 2 3 l 3 0 l 0 3 l -2 3 l -8 0 z', fill: '#120c09' }, dog);
        el('path', { d: 'M 0 0 l -2 -2 l 1 -1 z', fill: '#120c09' }, dog);
      }
    }


    if (s.tank) {
      const light = s.theme === 'light';
      // water body + surface shimmer line
      el('rect', {
        x: -40, y: 8, width: 180, height: 80, rx: 2,
        fill: light ? '#bfe8f0' : '#0a2d3a', opacity: light ? 0.75 : 0.75,
      }, bg);
      el('line', {
        x1: -40, y1: 9, x2: 140, y2: 9,
        stroke: light ? '#ffffff' : '#6fd3e6', 'stroke-width': 0.45, opacity: 0.75, class: 'water-surface',
      }, bg);

      // seabed
      el('ellipse', {
        cx: 50, cy: 80, rx: 58, ry: 5.5,
        fill: light ? '#e8dcc0' : '#0d3945',
      }, bg);

      // swaying plants, varied heights, each with its own phase
      const plantCols = light ? ['#4f9e6a', '#69b57d', '#3f8a5c'] : ['#2f7d5e', '#3f9469', '#256b50'];
      for (let i = 0; i < 7; i++) {
        const x = 8 + i * 13 + (i % 2) * 3;
        const hgt = 10 + ((i * 7) % 14);
        const g = el('g', { class: 'tank-weed', style: `transform-origin:${x}px 80px` }, bg);
        el('path', {
          d: `M ${x} 80 C ${x - 2.4} ${80 - hgt * 0.4} ${x + 2.4} ${80 - hgt * 0.7} ${x} ${80 - hgt}`,
          fill: 'none', stroke: plantCols[i % 3], 'stroke-width': 1.5,
          'stroke-linecap': 'round', opacity: 0.9,
        }, g);
        g.style.animationDuration = (4 + (i % 4) * 0.8).toFixed(2) + 's';
        g.style.animationDelay = (-i * 0.55).toFixed(2) + 's';
      }

      // fish: each in its own holder, swim animation runs on the INNER group so
      // the holder's translate/scale is preserved (that was the old bug).
      const fishCols = light
        ? ['#f2803d', '#3fa9d6', '#e0b23a', '#d95f8a']
        : ['#f2b45c', '#7fd0c6', '#e88f5a', '#9ad3e0'];
      for (let i = 0; i < 5; i++) {
        const y = 22 + i * 13 + (i % 2) * 4;
        const dir = i % 2 === 0 ? 1 : -1;
        const sc = 1.3 + (i % 3) * 0.35;
        const holder = el('g', {
          transform: `translate(0 ${y}) scale(${dir === 1 ? sc : -sc} ${sc})`,
        }, bg);
        const fish = el('g', { class: 'tank-swim', opacity: 0.95 }, holder);
        fish.style.animationDuration = (13 + i * 4) + 's';
        fish.style.animationDelay = (-i * 3.4).toFixed(2) + 's';
        fish.style.setProperty('--dir', dir === 1 ? '1' : '-1');
        const col = fishCols[i % fishCols.length];
        el('path', { d: 'M 6 0 q 6 -4.2 12 0 q -6 4.2 -12 0 z', fill: col }, fish);      // body
        el('path', { d: 'M 18 0 l 5 -3.2 l 0 6.4 z', fill: col, opacity: 0.9 }, fish);     // tail
        el('circle', { cx: 9.4, cy: -1.1, r: 0.62, fill: '#10151a' }, fish);              // eye
      }

      // rising bubbles
      for (let i = 0; i < 12; i++) {
        const b = el('circle', {
          cx: (10 + (i * 17) % 74).toFixed(1), cy: 76,
          r: (0.3 + (i % 4) * 0.16).toFixed(2),
          fill: light ? '#ffffff' : '#dff3f7', opacity: 0, class: 'tank-bubble',
        }, bg);
        b.style.animationDuration = (7 + (i % 5) * 1.7).toFixed(2) + 's';
        b.style.animationDelay = (-i * 1.15).toFixed(2) + 's';
      }
    }


    if (s.garden) {
      el('circle', { cx: 78, cy: 20, r: 8, fill: '#ffe6a3', opacity: 0.95, class: 'sun' }, bg);
      el('ellipse', { cx: 50, cy: 82, rx: 60, ry: 10, fill: '#8dbb78', opacity: 0.55 }, bg);
      for (let i = 0; i < 5; i++) {
        const x = 10 + i * 20, h = 20 + (i % 3) * 6;
        // trunk first so the canopy sits on top of it (drawing the canopy alone
        // left the tree apparently floating with no visible lower trunk)
        el('rect', {
          x: x - 1.1, y: 80 - h * 0.42, width: 2.2, height: h * 0.42,
          fill: '#6b4b2f', opacity: 0.95, rx: 0.4,
        }, bg);
        el('path', {
          d: `M ${x} ${80 - h * 0.30} L ${x - 7} ${80 - h * 0.34} L ${x} ${80 - h} L ${x + 7} ${80 - h * 0.34} Z`,
          fill: '#4f7f4a', opacity: 0.92, class: 'tree',
        }, bg).style.animationDelay = (i * 0.5).toFixed(1) + 's';
        el('path', {
          d: `M ${x} ${80 - h * 0.55} L ${x - 5.2} ${80 - h * 0.58} L ${x} ${80 - h * 1.06} L ${x + 5.2} ${80 - h * 0.58} Z`,
          fill: '#5b8f55', opacity: 0.9, class: 'tree',
        }, bg).style.animationDelay = (i * 0.5 + 0.2).toFixed(1) + 's';
      }
      for (let i = 0; i < 10; i++) {
        const leaf = el('ellipse', {
          cx: (i * 11) % 96 + 2, cy: 30 + (i % 4) * 12, rx: 0.8, ry: 0.4,
          fill: '#6fae5c', opacity: 0.8, class: 'cloud',
        }, bg);
        leaf.style.animationDuration = (12 + (i % 5) * 4) + 's';
        leaf.style.animationDelay = (-i * 1.7).toFixed(1) + 's';
      }
      for (const [x, y, flip] of [[36, 75, 1], [66, 73, -1]]) {
        const pet = el('g', { class: 'cloud', transform: `translate(${x} ${y}) scale(${flip} 1)` }, bg);
        pet.style.animationDuration = '22s';
        el('path', { d: 'M 0 0 h 7 l 1 -3 l 2 3 h 3 v 3 l -2 3 h -9 z', fill: '#3f5636' }, pet);
        el('path', { d: 'M 0 0 l -2 -2 l 1 -1 z', fill: '#3f5636' }, pet);
        el('path', { d: 'M 7 0 q 3 -3 4 0', fill: 'none', stroke: '#3f5636', 'stroke-width': 0.6 }, pet);
      }
    }

    el('line', { x1: -20, y1: 80, x2: 120, y2: 80, stroke: s.floor, 'stroke-width': 0.4 }, bg);
    svg.style.setProperty('--paper', s.sky[0]);
    document.documentElement.style.setProperty('--stage-bg', s.sky[0]);
    if (state.rigs.size) layout();
    document.querySelectorAll('#bgPresets button').forEach(b => b.classList.toggle('on', b.dataset.scene === key));
  }

  /* ------------------------------------------------------------- stage */

  const LAYOUTS = {
    1: { box: [18, 24, 64, 64], spots: [{ x: 50, h: 44 }] },
    2: { box: [12, 26, 76, 64], spots: [{ x: 28, h: 38 }, { x: 72, h: 38 }] },
    3: { box: [10, 28, 80, 62], spots: [{ x: 22, h: 34 }, { x: 50, h: 34 }, { x: 78, h: 34 }] },
    4: { box: [8, 30, 84, 58], spots: [{ x: 18, h: 30 }, { x: 39, h: 30 }, { x: 61, h: 30 }, { x: 82, h: 30 }] },
  };

  function layout() {
    const keep = new Map();
    for (const [id, rig] of state.rigs) keep.set(id, { emotion: rig.emotion, intensity: rig.intensity });
    state.rigs.clear(); state.views.clear(); state.labels.clear();
    for (const n of [...svg.querySelectorAll('.character, .castLabel')]) n.remove();
    const count = state.mode === 'single' ? 1 : Math.max(2, state.speakers.length);
    const plan = LAYOUTS[Math.min(4, count)] || LAYOUTS[4];
    state.baseBox = plan.box.slice();
    applyZoom();
    const ink = (SCENES[state.scene] || SCENES.paper).ink;
    state.speakers.slice(0, count).forEach((sp, i) => {
      const spot = plan.spots[i];
      const look = LOOK[sp.presentation] || LOOK.neutral;
      const rig = STICK.companion.createRig({
        figure: {
          id: sp.id, name: sp.name,
          // Start facing the viewer. A character only turns toward the other
          // person while they are actually speaking to them.
          facing: 0,
          style: state.style,
          body: state.body === 'bust' ? 'bust' : 'full',
          height: Math.round(spot.h * (look.h / 44)), headScale: 1.08,
          pos: { x: spot.x, y: state.body === 'bust' ? 62 : 80 },
          hair: look.hair, bodyColor: look.bodyColor, color: ink,
        },
      });
      const view = STICK.companion.mount(svg, rig, {
        style: state.style, manageViewBox: false,
        onTouch: part => {
          log('touch', `${sp.name} · ${part}`);
          // A poke is not a performance: never let it steal the caption while
          // a timed line owns the bubble.
          if (state.segActive == null) showBubble(reactionText(part), sp.id, 2200);
        },
      });
      const root = svg.querySelector(`.character[data-rig="${sp.id}"]`);
      if (root) root.style.cursor = HAND_CURSOR;
      state.rigs.set(sp.id, rig);
      state.views.set(sp.id, view);
      // keep each character's own look across layout rebuilds
      const mine = (state.looks && state.looks[sp.id]) || null;
      if (mine && view.setLook) {
        if (mine.wear && mine.wear !== 'none') view.setLook('wear', mine.wear);
        if (mine.face && mine.face !== 'none') view.setLook('face', mine.face);
      }
      // In the Room the two figures face each other; a lone figure faces front.
      if (count > 1 && plan.spots.length > 1) {
        const facing = i === 0 ? 1 : (i === plan.spots.length - 1 ? -1 : 0);
        state.facing = state.facing || {};
        state.facing[sp.id] = facing;
      }
      const label = el('text', {
        x: spot.x, y: state.body === 'bust' ? 76 : 86.6, 'text-anchor': 'middle', 'font-family': 'Georgia, serif',
        'font-size': 2.7, fill: (SCENES[state.scene] || SCENES.paper).theme === 'dark' ? '#ffffff' : sp.accent, class: 'castLabel',
      }, svg);
      label.textContent = sp.name;
      state.labels.set(sp.id, label);
    });
    for (const [id, prev] of keep) {
      const rig = state.rigs.get(id);
      if (rig && prev) rig.setEmotion(prev.emotion, { intensity: prev.intensity, duration: 0.01 });
    }
  }

  function reactionText(part) {
    return part === 'head' ? 'Oh! That tickles.'
      : part === 'torso' ? 'Hah, careful!'
        : part === 'armL' || part === 'armR' ? 'Hey there.'
          : 'Whoa!';
  }


  const ZOOM_MIN = 0.20;   // small enough to see the whole room
  const ZOOM_MAX = 1.80;
  const ZOOM_STEP = 0.05;

  function applyZoom() {
    const b = state.baseBox || [18, 24, 64, 64];
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.zoom || 0.45));
    state.zoom = z;
    const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
    const w = b[2] / z, h = b[3] / z;
    svg.setAttribute('viewBox', [cx - w / 2, cy - h / 2, w, h].map(v => v.toFixed(3)).join(' '));
    const lvl = $('zoomLevel');
    if (lvl) lvl.textContent = Math.round(z * 100) + '%';
    document.querySelectorAll('#zoomBar .preset').forEach(btn => {
      btn.classList.toggle('on', Math.abs(parseFloat(btn.dataset.zoom) - z) < 0.03);
    });
  }

  function nudgeZoom(delta) {
    state.zoom = Math.round((state.zoom + delta) * 100) / 100;
    applyZoom();
  }

  /* Camera moves: a whisper leans in close, then goes back to the wide shot.
     Implemented by tweening the zoom the same way the pill does, so nothing
     else in the app has to know about it. */
  let cameraTimer = null;
  function cameraMove(kind, ms) {
    if (cameraTimer) { clearTimeout(cameraTimer); cameraTimer = null; }
    const home = state.zoom;
    if (kind === 'closeup') {
      state.zoom = Math.max(state.zoom, Math.min(ZOOM_MAX, home * 1.9));
      applyZoom();
      cameraTimer = setTimeout(() => { state.zoom = home; applyZoom(); cameraTimer = null; }, ms || 2600);
    } else if (kind === 'push') {
      state.zoom = Math.max(state.zoom, Math.min(ZOOM_MAX, home * 1.25));
      applyZoom();
      cameraTimer = setTimeout(() => { state.zoom = home; applyZoom(); cameraTimer = null; }, ms || 1800);
    }
  }

  const rig1 = () => state.rigs.get(state.speakers[0].id);
  const rigFor = id => state.rigs.get(id) || rig1();
  const speakerById = id => state.speakers.find(s => s.id === id) || null;

  /* ------------------------------------------------------------ bubble */

  const bubble = $('bubble');
  const bubbleText = $('bubbleText');
  let bubbleUntil = 0;
  let bubbleWho = null;

  function showBubble(text, who, ms) {
    if (!text) return;
    bubbleText.textContent = text.length > 120 ? text.slice(0, 117) + '…' : text;
    bubble.hidden = false;
    bubbleWho = who;
    bubbleUntil = performance.now() + (ms || Math.max(1600, text.length * 55));
    positionBubble();
  }
  function hideBubble() { bubble.hidden = true; bubbleWho = null; }

  function positionBubble() {
    if (bubble.hidden) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    // The performer under the bubble is the one who owns the highlighted row.
    // During a timed performance that is state.segActive; bubbles outside a
    // performance (touch reaction, replay, stage direction) use bubbleWho.
    const active = (state.segActive != null && state.segMeta) ? state.segMeta[state.segActive] : null;
    const who = (active && active.speaker_id) || bubbleWho;
    let rig = (who && state.rigs.get(who))
      || rig1()
      || state.rigs.values().next().value
      || null;
    // If the speaker's rig exists but its pose is not ready, borrow the first
    // rig's pose; only if that is missing too do we use the stage centre.
    if (rig && !rig.pose) {
      const first = rig1() || state.rigs.values().next().value || null;
      if (first && first.pose) rig = first;
    }
    let x, y;
    if (rig && rig.pose && rig.pose.world && rig.pose.world.head) {
      // Read the live pose every frame: if they walk or lean, the bubble follows.
      x = rig.pose.world.head.x;
      y = rig.pose.world.head.y - ((rig.pose.g && rig.pose.g.headR) || 4) * 1.5;
    } else {
      // No pose yet: park it over the middle of the stage instead of leaving it
      // at the last coordinates (which read as "beside the stickman").
      const vb = (svg.getAttribute('viewBox') || '18 24 64 64').split(/\s+/).map(Number);
      x = vb[0] + vb[2] / 2;
      y = vb[1] + vb[3] * 0.42;
    }
    const p = svg.createSVGPoint();
    p.x = x;
    p.y = y;
    const s = p.matrixTransform(ctm);
    // style.left/top are relative to the bubble's containing block (the stage
    // area), not the page, so measure against that element.
    const host = bubble.offsetParent || svg;
    const frame = host.getBoundingClientRect();
    const w = bubble.offsetWidth || 0;
    const h = bubble.offsetHeight || 0;
    const PAD = 8;
    let left = s.x - frame.left;
    let top = s.y - frame.top - 6;
    // The bubble is centred on `left` (transform: translate(-50%, -100%)).
    // Clamp its centre so the whole box — plus padding — stays inside the stage.
    const half = w / 2;
    if (!w || frame.width <= w + PAD * 2) {
      left = frame.width / 2;
    } else {
      left = Math.min(Math.max(left, half + PAD), frame.width - half - PAD);
    }
    // Same guard vertically: the translated box must not poke out of the top.
    if (h) top = Math.max(top, h + PAD);
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
  }

  /* ---------------------------------------------------------------- tts */

  const tts = new window.TTSClient({
    base: API, rigFor, rig: null,
    onSegment: ev => applySegment(ev),
    onCached: take => addHistory(take),
    onStatus: onVoiceStatus,
    onMetrics: onMetrics,
    onLog: ev => {
      log(ev.type, ev.message);
      // Track which engine/model actually produced audio, so the status chip
      // reports the truth rather than the configured default.
      const m = String(ev.message || '');
      const spoken = m.match(/spoken with "([^"]+)"(?: via (\w+))?/i)
        || m.match(/spoken via (\w+) after fallback/i);
      if (spoken) {
        state.activeModel = spoken[1] || state.activeModel;
        state.activeEngine = (spoken[2] || (m.match(/via (\w+)/i) || [])[1] || '').toLowerCase();
        paintVoiceChip();
      }
    },
  });

  function paintVoiceChip() {
    const chip = $('voiceState');
    if (!chip) return;
    const h = tts.health || {};
    if (state.activeModel) {
      // show the exact model that spoke last, not the configured default
      const shortModel = String(state.activeModel)
        .replace(/^gemini-/, '').replace(/-tts$/, '')
        .replace(/:free$/, '').replace(/^.*\//, '');
      const engine = state.activeEngine === 'openrouter' ? 'OR' : 'Gemini';
      chip.textContent = `${engine} · ${shortModel}`;
    } else {
      const base = h.provider === 'gemini' ? 'Gemini' : (h.provider || 'voice');
      const short = (h.model || '').replace(/^gemini-/, '').replace(/-tts$/, '');
      chip.textContent = short ? `${base} · ${short}` : base;
    }
  }

  function onVoiceStatus(h) {
    tts.health = h;
    paintVoiceChip();
    // When the voice stops, the performance is over: close the bubble and settle
    // the timeline. Without this the last line's bubble lingered after silence.
    if (h && h.speaking === false) {
      hideBubble();
      state.segActive = null;
      for (const li of $('timeline').querySelectorAll('li[data-status="playing"]')) {
        markSegment(+li.dataset.index, 'done');
      }
    }
    const chip = $('voiceState');
    if (chip) {
      chip.dataset.state = h.provider || 'offline';
      chip.title = [h.note, h.error].filter(Boolean).join('\n');
    }
  }

  function onMetrics(m) {
    if (m.cached) { $('latency').textContent = 'replay'; return; }
    if (m.firstAudioMs != null) $('latency').textContent = m.firstAudioMs + ' ms';
    else if (m.endedMs != null) $('latency').textContent = (m.endedMs / 1000).toFixed(1) + ' s';
    else $('latency').textContent = '—';
  }

  async function refreshHealth() {
    const h = await tts.probe();
    state.voices = h.voices || [];
    state.voiceMeta = h.voiceMeta || {};
    // Pull the full voice catalog (Gemini + OpenRouter, each tagged with gender)
    // once, so the voice pickers can group by gender and never hand a male
    // character a female voice.
    if (!state.voiceCatalog) {
      try {
        const r = await fetch(API + '/api/voices');
        const d = await r.json().catch(() => ({}));
        if (d && d.ok && Array.isArray(d.voices)) state.voiceCatalog = d.voices;
      } catch (e) { /* offline: fall back to health voices */ }
    }
    fillVoices();
    fillModels(h.models || []);
    const short = (h.model || '').replace('gemini-3.8-', '').replace('-tts', '');
    // The button is a plain "Voices" entry point; which engine is serving is
    // shown inside the panel, not in the button label.
    const activeSpace = (state.speakers[0] && state.speakers[0].voice) || short || '';
    $('voiceBtnLabel').textContent = activeSpace ? 'Voices · ' + activeSpace : 'Voices';
    return h;
  }

  /* --------------------------------------------------------------- log */

  function log(kind, message) {
    const li = document.createElement('li');
    if (kind === 'error') li.className = 'bad';
    const b = document.createElement('b'); b.textContent = kind;
    const s = document.createElement('span'); s.textContent = message;
    li.append(b, s);
    $('log').prepend(li);
    while ($('log').children.length > 40) $('log').lastChild.remove();
  }

  /* ----------------------------------------------------------- history */

  function addHistory(take) {
    if (!take || !take.capture || !take.capture.length) return;
    // remember it so the scrubber and seek buttons have something to work on
    state.lastTake = take;
    state.takeAt = 0;
    // While an Action is running each beat speaks separately; collect the
    // pieces and file them as ONE take instead of one entry per line.
    if (state.actionRun) {
      state.actionTake = state.actionTake || { segments: [], capture: [] };
      state.actionTake.segments.push(...(take.segments || []));
      state.actionTake.capture.push(...(take.capture || []));
      return;
    }
    state.history.unshift({
      id: 'h' + Date.now(),
      label: take.segments.map(s => s.text).join(' ').slice(0, 70),
      mode: state.mode,
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      take,
    });
    state.history = state.history.slice(0, 8);
    renderHistory();
  }

  // Called when an Action finishes: fold every beat's audio into one take.
  function flushActionTake() {
    const t = state.actionTake;
    state.actionTake = null;
    if (!t || !t.capture.length) return;
    const take = { segments: t.segments, capture: t.capture };
    state.lastTake = take;
    state.takeAt = 0;
    state.history.unshift({
      id: 'h' + Date.now(),
      label: (t.segments.map(s => s.text).join(' ')).slice(0, 70),
      mode: state.mode,
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      take,
    });
    state.history = state.history.slice(0, 8);
    renderHistory();
  }

  function renderHistory() {
    const list = $('history');
    list.innerHTML = '';
    if (!state.history.length) {
      list.innerHTML = '<li class="empty">Finished takes appear here.</li>';
      return;
    }
    state.history.forEach(entry => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="dot"></span><div class="seg-body"><p class="seg-text"></p>'
        + `<p class="seg-meta">${entry.at} · ${entry.mode}</p></div>`
        + '<div class="seg-actions"><button class="ghost small replay">Replay</button>'
        + '<button class="ghost small dl" title="Download this take as a video">⬇ Save</button></div>';
      li.querySelector('.seg-text').textContent = entry.label;
      li.querySelector('.replay').addEventListener('click', async () => {
        // The cached audio cues call setCurrentSegment() too, so the bubble
        // opens with the first line's audio instead of 2.6s early. Render the
        // take's own lines first, so the highlighted row is the spoken line.
        if (entry.take.segments && entry.take.segments.length) renderTimeline(entry.take.segments);
        hideBubble();
        if (await tts.playCached(entry.take)) log('history', 'cached replay');
      });
      li.querySelector('.dl').addEventListener('click', ev => {
        ev.stopPropagation();
        downloadTake(entry);
      });
      list.appendChild(li);
    });
  }

  /* Export a take as a video. MediaRecorder gives WebM (plays in Chrome,
     Firefox, Edge, VLC); if the browser can produce MP4 we prefer that. */
  async function downloadTake(entry) {
    log('export', 'rendering video…');
    const scene = SCENES[state.scene] || SCENES.paper;
    let ctrl;
    try {
      ctrl = window.StickRecorder.start({
        svg, width: 1280, height: 960, fps: 30, background: scene.sky,
      });
    } catch (e) {
      log('error', 'could not start export: ' + e.message);
      return;
    }
    try {
      await tts.playCached(entry.take).catch(() => {});
      // let the tail of the animation settle into the recording
      await new Promise(r => setTimeout(r, 600));
    } finally {
      const blob = await ctrl.stop();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `stick-take-${stamp}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      log('export', `downloaded webm (${Math.round(blob.size / 1024)} KB)`);
    }
  }

  /* ---------------------------------------------------------- timeline */

  function renderTimeline(segments) {
    state.segments = segments || [];
    state.segActive = null;
    const list = $('timeline');
    list.innerHTML = '';
    if (!state.segments.length) {
      list.innerHTML = '<li class="empty">Nothing yet.</li>';
      return;
    }
    state.segments.forEach((seg, i) => {
      const li = document.createElement('li');
      li.dataset.index = i;
      const sp = speakerById(seg.speaker_id) || state.speakers[0];
      li.innerHTML = `<span class="dot" style="background:${sp.accent}"></span>
        <div class="seg-body"><p class="seg-text"></p><p class="seg-meta"></p></div>
        <span class="seg-state">queued</span>`;
      li.querySelector('.seg-text').textContent = seg.text;
      li.querySelector('.seg-meta').textContent =
        `${sp.name} · ${seg.emotion}${seg.gesture ? ' · ' + seg.gesture : ''}`;
      list.appendChild(li);
    });
  }

  function markSegment(index, status) {
    const li = $('timeline').querySelector(`li[data-index="${index}"]`);
    if (!li) return;
    li.dataset.status = status;
    li.querySelector('.seg-state').textContent = status;
  }

  // The row the timeline is showing as "playing"; used to anchor the bubble.
  function segmentAt(index) {
    if (index == null) return null;
    return (state.segments && state.segments[index])
      || (state.segMeta && state.segMeta[index])
      || null;
  }

  /* Single source of truth for "which line is current". The highlight and the
     bubble are written here together, so the caption can never describe a row
     other than the one the timeline marks as playing. */
  function setCurrentSegment(index) {
    if (index == null) return;
    // Any other row that still says "playing" is finished now. Earlier rows are
    // done too (a skipped cue should not leave them queued); later rows stay
    // queued so the list keeps its one-playing / rest-queued shape.
    for (const li of $('timeline').querySelectorAll('li[data-index]')) {
      const i = +li.dataset.index;
      if (i === index) continue;
      if (li.dataset.status === 'playing' || i < index) markSegment(i, 'done');
    }
    markSegment(index, 'playing');
    const row = segmentAt(index);
    state.segActive = index;
    if (row && row.text) {
      // Infinity: the audio cue is the only clock. The bubble stays up until the
      // next cue opens the following line or the voice stops — never a
      // text-length timer, which let it vanish mid-sentence or pop early.
      showBubble(row.text, row.speaker_id, Infinity);
    }
  }

  function applySegment(ev) {
    // The cue arrives from the server and carries only the basic fields. Merge
    // the LOCAL segment (emotion, gesture, camera, beat) for this index so every
    // line — not just the first — gets its expression and movement.
    const local = (state.segMeta && ev.index != null) ? state.segMeta[ev.index] : null;
    if (local) {
      ev = {
        ...local, ...ev,
        emotion: ev.emotion || local.emotion,
        gesture: ev.gesture || local.gesture,
        intensity: ev.intensity == null ? local.intensity : ev.intensity,
        text: ev.text || local.text,
        camera: ev.camera || local.camera,
      };
    }
    const rig = rigFor(ev.speaker_id);
    if (ev.speaker_id) state.activeId = ev.speaker_id;
    rig.apply({ type: 'speech', value: 'speaking' });
    rig.setEmotion(ev.emotion || 'neutral', { intensity: ev.intensity == null ? 1 : ev.intensity, duration: 240 });
    // Every spoken line needs visible life, even when the plan gives no gesture
    // (Speak uses one emotion for all lines, so without this only the mouth
    // moved and later segments looked frozen). Action stages its own beats, so
    // this is skipped while an action is running.
    if (ev.gesture) {
      rig.gesture(ev.gesture);
    } else if (ev.text && !state.actionRun) {
      const ACCENT = ['nod', 'beat', 'head_tilt', 'nod', 'beat'];
      rig.gesture(ACCENT[(ev.index || 0) % ACCENT.length]);
    }
    if (ev.index != null) {
      // Keep both the row and its meta entry in step with the cue that is
      // actually playing, so setCurrentSegment() and positionBubble() read
      // exactly the line and speaker the timeline highlights.
      state.segMeta = state.segMeta || [];
      state.segMeta[ev.index] = { ...(state.segMeta[ev.index] || {}), ...ev };
      state.segments[ev.index] = { ...(state.segments[ev.index] || {}), ...ev };
      setCurrentSegment(ev.index);
    }
    // camera follows the performance: whisper leans in, then returns
    const txt = String(ev.text || '');
    if (ev.camera === 'closeup' || /\b(whisper|whispers|murmur|quietly|under .{0,6}breath)\b/i.test(txt)) {
      cameraMove('closeup', 2600);
    } else if (ev.camera === 'push') {
      cameraMove('push', 1800);
    }

    // Stage this beat now, on the audio clock. Previously Action pre-scheduled
    // beats on wall-clock timers, which drifted from the voice: the audio
    // finished while actions kept firing.
    const beat = ev.beat || (state.segBeats && ev.index != null ? state.segBeats[ev.index] : null);
    if (beat && actionStager) {
      try { actionStager.play({ ...beat, at: 0 }); } catch (err) { log('error', 'stage: ' + err.message); }
    }
    // Turn to face whoever they are addressing, then back to the viewer.
    if (state.mode === 'podcast' && state.speakers.length > 1 && ev.speaker_id) {
      const me = state.speakers.findIndex(s => s.id === ev.speaker_id);
      const other = state.speakers[(me + 1) % state.speakers.length];
      const myRig = state.rigs.get(ev.speaker_id);
      const otherRig = state.rigs.get(other.id);
      if (myRig && otherRig && myRig.pose && otherRig.pose) {
        const towardRight = otherRig.pose.world.head.x > myRig.pose.world.head.x;
        if (myRig.faceFor) myRig.faceFor(towardRight ? 1 : -1, Math.max(2200, (ev.text || '').length * 62));
      }
    }
    highlightCast(ev.speaker_id);
    updateStatus();
  }

  function highlightCast(id) {
    document.querySelectorAll('.cast-row').forEach(r => {
      r.classList.toggle('speaking', r.dataset.id === id && state.mode === 'podcast');
    });
  }

  /* ------------------------------------------------------------ speech */

  function stopAll(reason) {
    if (state.actionRun) { state.actionRun.cancelled = true; state.actionRun = null; }
    tts.stop(reason || 'stopped');
    for (const rig of state.rigs.values()) { rig.setSinging(false); rig.stopSpeech(); }
    for (const li of $('timeline').querySelectorAll('li[data-status="playing"]')) markSegment(+li.dataset.index, 'stopped');
    highlightCast(null);
    hideBubble();
    state.segActive = null;
    state.localPlan = null;
    setBusy(false);
    updateStatus();
  }

  function setBusy(busy, label) {
    state.busy = busy;
    ['speak', 'speakActions', 'act', 'sing'].forEach(id => { $(id).disabled = busy; });
    if (label) $('status').textContent = label;
  }

  const activeProvider = kind => state.providers.find(p => p.kind === kind && p.active) || null;
  function providerPayload() {
    const ttsP = activeProvider('tts');
    const llmP = activeProvider('llm');
    const out = {};
    if (ttsP) {
      if (ttsP.key) out.geminiKey = ttsP.key;
      if (ttsP.model) out.model = ttsP.model;
      if (ttsP.voice) out.voice = ttsP.voice;
    }
    if (llmP) {
      if (llmP.key) out.llmKey = llmP.key;
      if (llmP.base) out.llmBase = llmP.base;
      if (llmP.model) out.llmModel = llmP.model;
    }
    return out;
  }

  const currentLines = () => state.script.filter(r => r.text.trim());

  // Break a paragraph into speakable sentences so each one can carry its own
  // cue (bubble + gesture). Keeps abbreviations like "Mr." intact reasonably.
  function splitSentences(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const parts = clean
      .split(/(?<=[.!?…])\s+(?=[A-Z0-9"'“¿¡])/)
      .map(s => s.trim())
      .filter(Boolean);
    // very long sentences get split again at commas so cues stay frequent
    const out = [];
    for (const p of parts) {
      if (p.length <= 140) { out.push(p); continue; }
      let buf = '';
      for (const bit of p.split(/(?<=[,;:])\s+/)) {
        if ((buf + ' ' + bit).trim().length > 120 && buf) { out.push(buf.trim()); buf = bit; }
        else buf = (buf + ' ' + bit).trim();
      }
      if (buf.trim()) out.push(buf.trim());
    }
    return out.length ? out : [clean];
  }

  async function speakDirect() {
    if (state.mode === 'single') {
      const text = $('text').value.trim();
      if (!text) return;
      const sp = state.speakers[0];
      // Split the text into sentences and send them as SEGMENTS. Sending it as
      // one `text` made the service return a single segment, so only the first
      // line ever got a cue — audio played on but no bubble or gesture followed.
      const parts = splitSentences(text);
      const emo = $('speakEmotion').value !== 'auto' ? $('speakEmotion').value : 'neutral';
      const ges = $('speakGesture').value !== 'none' ? $('speakGesture').value : null;
      const segs = parts.map((t, i) => ({
        id: 'ss' + (i + 1),
        speaker_id: sp.id,
        voice: sp.voice,
        text: t,
        emotion: emo,
        intensity: 1,
        gesture: ges,
        pause_after_ms: 80,
      }));
      if (!tts.canSpeak) { synthetic(segs); return; }
      setBusy(true, 'Speaking…');
      try {
        await playSegments(segs);
      } finally { setBusy(false); updateStatus(); }
      return;
    }
    if (state.ptab === 'script') {
      const rows = currentLines();
      if (!rows.length) return;
      const segs = rows.map((r, i) => {
        const sp = speakerById(r.speakerId) || state.speakers[0];
        return { id: 's' + (i + 1), speaker_id: sp.id, text: r.text, emotion: 'neutral', intensity: 1, gesture: null, voice: sp.voice, pause_after_ms: 0 };
      });
      renderTimeline(segs); state.plan = null;
      await playSegments(segs);
      return;
    }
    const text = $('topicText').value.trim();
    if (!text) return;
    // Room + Concept: Speak must stay fast, so split locally into alternating
    // lines and start audio immediately. The planner is the job of Perform.
    if (state.speakers.length > 1) {
      const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      const alt = (parts.length ? parts : [text]).slice(0, 8).map((t, i) => {
        const sp = state.speakers[i % state.speakers.length];
        return { id: 's' + (i + 1), speaker_id: sp.id, text: t, emotion: 'neutral',
                 intensity: 1, gesture: null, voice: sp.voice, pause_after_ms: 120 };
      });
      renderTimeline(alt); state.plan = null;
      await playSegments(alt);
      return;
    }
    await synthSingle(text, state.speakers[0]);
  }

  async function speakWithActions(opts) {
    const forced = opts && opts.skipGuard;
    if (!forced && (!tts.health || !tts.health.llm || !tts.health.llm.configured)) {
      log('error', 'No planner configured — speaking directly');
      return speakDirect();
    }
    const single = state.mode === 'single';
    const scriptMode = state.mode === 'podcast' && state.ptab === 'script';
    let text;
    if (single) text = (state.ptab === 'topic' ? $('topicText').value : $('text').value).trim();
    else if (scriptMode) {
      text = currentLines().map(r => `${(speakerById(r.speakerId) || state.speakers[0]).name}: ${r.text}`).join('\n');
    } else text = $('topicText').value.trim();
    if (!text) return;

    setBusy(true, 'Planning…');
    state.plan = null;
    try {
      const res = await fetch(API + '/api/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text, mode: state.mode, topic: state.ptab === 'topic',
          speakers: state.speakers.map(s => ({ id: s.id, name: s.name, voice: s.voice })),
          provider: providerPayload(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { log('error', data.error || `planner ${res.status}`); setBusy(false); return; }
      state.plan = data.plan;
      const segs = data.plan.segments.map(s => ({ ...s, voice: (speakerById(s.speaker_id) || state.speakers[0]).voice }));
      renderTimeline(segs);
      if (!tts.canSpeak) { synthetic(segs); setBusy(false); return; }
      await playSegments(segs);
    } catch (err) {
      log('error', 'planner failed: ' + err.message);
    } finally { setBusy(false); updateStatus(); }
  }

  async function synthSingle(text, sp) {
    setBusy(true, 'Speaking…');
    try {
      await tts.speak({
        segments: [{ text, speaker_id: sp.id, emotion: 'neutral', intensity: 1, voice: sp.voice }],
        model: $('model').value, mode: state.mode, provider: providerPayload(),
        speakers: state.speakers.map(s => ({ id: s.id, name: s.name, voice: s.voice })),
      });
    } finally { setBusy(false); updateStatus(); }
  }

  async function playSegments(segs) {
    // Single is one performer: never let a second (or female) voice leak in
    // from a cast that still carries the Room partner.
    if (state.mode === 'single') {
      const lead = state.speakers[0];
      segs = segs.map(s => ({ ...s, speaker_id: lead.id, voice: lead.voice }));
    }
    // If the provider just told us the quota is gone, don't spend ~6s retrying
    // four exhausted models on every line — play locally straight away.
    if (state.voiceDownUntil && Date.now() < state.voiceDownUntil) {
      log('voice', 'quota exhausted — playing locally (visual performance continues)');
      renderTimeline(segs);
      synthetic(segs);
      return;
    }
    renderTimeline(segs);
    state.plan = null;
    // keep the local segment data so every cue can recover its own emotion,
    // gesture and beat (the server event only carries the basics)
    state.segMeta = segs.slice();
    // no pre-emptive bubble: it used to appear the moment the TEXT arrived,
    // which is why the comment ran ahead of the voice. The audio-clock cue
    // opens it instead.
    await tts.speak({
      segments: segs.map(s => ({
        text: s.text, emotion: s.emotion, intensity: s.intensity, gesture: s.gesture,
        style: s.style, speaker_id: s.speaker_id, voice: s.voice, model: $('model').value,
        pause_after_ms: s.pause_after_ms || 0,
      })),
      model: $('model').value, mode: state.mode, provider: providerPayload(),
      speakers: state.speakers.map(s => ({ id: s.id, name: s.name, voice: s.voice })),
    });
    if (tts.lastError) {
      const msg = String(tts.lastError.message || '');
      // Remember that the quota is gone so the next line does not wait again.
      if (/quota/i.test(msg)) {
        state.voiceDownUntil = Date.now() + 90_000;
        log('voice', 'TTS quota exhausted — switching to local playback for 90s');
      }
      synthetic(segs);
    }
  }

  function synthetic(segs) {
    if (!segs.length) return;
    let acc = 0;
    const schedule = segs.map(s => {
      const at = acc;
      const dur = Math.max(1, s.text.length * 0.055 + 0.3);
      acc += dur;
      return { at, dur, seg: s };
    });
    // Render first so the row the first cue highlights already exists; there is
    // no audio here, so the local plan clock drives every segment.
    renderTimeline(segs);
    applySegment({ ...segs[0], index: 0 });
    rigFor(segs[0].speaker_id).startSpeech(segs.map(s => s.text).join(' '), { duration: acc });
    state.localPlan = { start: performance.now() / 1000, schedule, i: 1 };
  }

  /* ------------------------------------------------------------- cast */

  function voiceOptions(select, current, presentation) {
    select.innerHTML = '';
    // Prefer the catalog from /api/voices (it knows provider + gender for both
    // Gemini and OpenRouter). Fall back to the health voice list.
    let entries = [];
    if (state.voiceCatalog && state.voiceCatalog.length) {
      entries = state.voiceCatalog.map(v => ({
        id: v.id, gender: v.gender, tone: v.tone,
        provider: v.provider, verified: v.verified !== false,
      }));
    } else {
      entries = (state.voices.length ? state.voices : ['Charon', 'Kore', 'Puck', 'Fola']).map(v => ({
        id: v,
        gender: (state.voiceMeta[v] && state.voiceMeta[v].gender) || 'unknown',
        tone: (state.voiceMeta[v] && state.voiceMeta[v].tone) || '',
        provider: 'gemini', verified: true,
      }));
    }

    // A male character only sees male voices, a female only female ones.
    const want = presentation === 'feminine' ? 'female'
      : presentation === 'masculine' ? 'male' : null;
    if (want) {
      const matching = entries.filter(v => v.gender === want);
      if (matching.length) entries = matching;
    }

    const groups = {};
    for (const v of entries) (groups[v.gender] = groups[v.gender] || []).push(v);
    for (const key of ['female', 'male', 'neutral', 'unknown']) {
      if (!groups[key] || !groups[key].length) continue;
      const og = document.createElement('optgroup');
      og.label = { female: 'Female', male: 'Male', neutral: 'Neutral', unknown: 'Other' }[key];
      for (const v of groups[key]) {
        const o = document.createElement('option');
        o.value = v.id;
        const prov = v.provider === 'openrouter' ? ' ⇢ OR' : '';
        const unver = v.verified ? '' : ' °';
        o.textContent = v.id + (v.tone ? ` · ${v.tone}` : '') + prov + unver;
        og.appendChild(o);
      }
      select.appendChild(og);
    }
    if (current) select.value = current;
    // if the current voice was filtered out, fall back to the first option
    if (!select.value) select.selectedIndex = 0;
  }

  // Pick a voice that matches a speaker's gender for the active provider.
  function voiceForGender(gender, provider) {
    const cat = state.voiceCatalog || [];
    const want = gender === 'feminine' ? 'female' : gender === 'masculine' ? 'male' : 'neutral';
    const pool = cat.filter(v => v.provider === (provider || 'gemini'));
    const exact = pool.find(v => v.gender === want);
    if (exact) return exact.id;
    const fallback = pool.find(v => v.gender === 'neutral') || pool[0];
    return fallback ? fallback.id : null;
  }

  function fillVoices() {
    if (!state.speakers.length) return;
    voiceOptions($('voice'), state.speakers[0].voice, state.speakers[0].presentation);
    document.querySelectorAll('.cast-row').forEach(row => {
      const sp = speakerById(row.dataset.id);
      if (sp) voiceOptions(row.querySelector('.voice'), sp.voice, sp.presentation);
    });
  }

  function fillModels(models) {
    const list = models && models.length ? models : ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
    const sel = $('model');
    const keep = sel.value;
    sel.innerHTML = '';
    const g = document.createElement('optgroup');
    g.label = 'Gemini';
    for (const m of list) {
      const o = document.createElement('option');
      o.value = m; o.textContent = m.replace('gemini-3.8-', '').replace('-tts', '');
      g.appendChild(o);
    }
    sel.appendChild(g);
    // OpenRouter speech models, offered as an explicit choice so the user can
    // force the fallback instead of waiting for Gemini to fail.
    const or = (tts.health && tts.health.openrouter && tts.health.openrouter.models) || [];
    if (or.length) {
      const og = document.createElement('optgroup');
      og.label = 'OpenRouter';
      for (const m of or) {
        const o = document.createElement('option');
        o.value = m;
        o.textContent = m.split('/')[1].replace(':free', '');
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    const all = list.concat(or);
    sel.value = keep && all.includes(keep) ? keep : (all[0] || '');
  }

  function renderCast() {
    const wrap = $('castList');
    wrap.innerHTML = '';
    const shown = state.mode === 'single' ? state.speakers.slice(0, 1) : state.speakers;
    shown.forEach(sp => {
      const row = document.createElement('div');
      row.className = 'cast-row';
      row.dataset.id = sp.id;
      row.innerHTML = `<span class="dot" style="background:${sp.accent}"></span>
        <input class="name" maxlength="16" aria-label="Name">
        <select class="pres" aria-label="Presentation">
          <option value="feminine">feminine</option><option value="masculine">masculine</option><option value="neutral">neutral</option>
        </select>
        <select class="voice" aria-label="Voice"></select>
        <button class="ghost icon preview" title="Preview">▶</button>
        <button class="ghost icon remove" title="Remove">×</button>`;
      row.querySelector('.name').value = sp.name;
      row.querySelector('.pres').value = sp.presentation;
      row.querySelector('.name').addEventListener('input', e => {
        sp.name = e.target.value || sp.id;
        const label = state.labels.get(sp.id); if (label) label.textContent = sp.name;
        renderScript();
      });
      row.querySelector('.pres').addEventListener('change', e => { sp.presentation = e.target.value; layout(); });
      row.querySelector('.voice').addEventListener('change', e => { sp.voice = e.target.value; });
      row.querySelector('.preview').addEventListener('click', () => previewVoice(sp));
      row.querySelector('.remove').addEventListener('click', () => removeSpeaker(sp.id));
      wrap.appendChild(row);
    });
    fillVoices();
    $('addSpeaker').disabled = state.speakers.length >= 4;
  }

  function addSpeaker() {
    if (state.speakers.length >= 4) return;
    if (state.mode === 'single') { setMode('podcast'); return; }
    const i = state.speakers.length;
    state.speakers.push({
      id: 's' + (i + 1), name: ['Ava', 'Cleo', 'Dex', 'Mia'][i % 4],
      presentation: ['feminine', 'neutral', 'masculine', 'feminine'][i % 4],
      voice: ['Fola', 'Kore', 'Puck', 'Aoede'][i % 4],
      accent: ACCENTS[i % ACCENTS.length],
    });
    layout(); renderCast(); renderScript();
  }

  function removeSpeaker(id) {
    if (state.speakers.length <= (state.mode === 'podcast' ? 2 : 1)) return;
    state.speakers = state.speakers.filter(s => s.id !== id);
    state.script = state.script.filter(r => r.speakerId !== id);
    if (!state.script.length) state.script.push({ speakerId: state.speakers[0].id, text: '' });
    layout(); renderCast(); renderScript();
  }

  async function previewVoice(sp) {
    const text = `Hi, I am ${sp.name}.`;
    if (!tts.canSpeak) { log('preview', 'no voice backend'); return; }
    renderTimeline([{ text, speaker_id: sp.id, emotion: 'happy', gesture: 'wave' }]);
    await tts.speak({
      segments: [{ text, speaker_id: sp.id, emotion: 'happy', intensity: 0.8, gesture: 'wave', voice: sp.voice }],
      model: $('model').value, mode: state.mode, provider: providerPayload(),
      speakers: state.speakers.map(s => ({ id: s.id, name: s.name, voice: s.voice })),
    });
  }

  /* ----------------------------------------------------------- script */

  function renderScript() {
    const list = $('scriptList');
    list.innerHTML = '';
    state.script.forEach((row, i) => {
      const sp = speakerById(row.speakerId) || state.speakers[0];
      const r = document.createElement('div');
      r.className = 'script-row';
      r.innerHTML = `<span class="dot" style="background:${sp.accent}"></span>
        <select class="who" aria-label="Speaker"></select>
        <input class="line" aria-label="Line" placeholder="Write a line…">
        <button class="ghost icon del" title="Remove">×</button>`;
      const sel = r.querySelector('.who');
      state.speakers.forEach(s => {
        const o = document.createElement('option');
        o.value = s.id; o.textContent = s.name;
        sel.appendChild(o);
      });
      sel.value = sp.id;
      sel.addEventListener('change', e => { row.speakerId = e.target.value; renderScript(); });
      const input = r.querySelector('.line');
      input.value = row.text;
      input.addEventListener('input', e => { row.text = e.target.value; });
      r.querySelector('.del').addEventListener('click', () => {
        state.script.splice(i, 1);
        if (!state.script.length) state.script.push({ speakerId: state.speakers[0].id, text: '' });
        renderScript();
      });
      list.appendChild(r);
    });
    const a = state.speakers[0], b = state.speakers[1];
    $('addLineA').textContent = a ? `+ ${a.name}` : '+ line';
    $('addLineB').textContent = b ? `+ ${b.name}` : '+ line';
    $('addLineB').disabled = !b;
  }

  $('addLineA').addEventListener('click', () => { state.script.push({ speakerId: state.speakers[0].id, text: '' }); renderScript(); });
  $('addLineB').addEventListener('click', () => {
    const sp = state.speakers[1] || state.speakers[0];
    state.script.push({ speakerId: sp.id, text: '' }); renderScript();
  });

  /* ------------------------------------------------------------- tabs */

  function openDrawer(tab) {
    $('drawer').hidden = false;
    $('scrim').hidden = false;
    requestAnimationFrame(() => { $('drawer').classList.add('on'); $('scrim').classList.add('on'); });
    if (tab) selectTab(tab);
  }
  function closeDrawer() {
    $('drawer').classList.remove('on');
    $('scrim').classList.remove('on');
    setTimeout(() => { if (!$('drawer').classList.contains('on')) { $('drawer').hidden = true; $('scrim').hidden = true; } }, 340);
  }
  function selectTab(tab) {
    document.querySelectorAll('#drawerTabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('on', p.dataset.page === tab));
  }

  $('openDrawer').addEventListener('click', () => openDrawer());
  $('closeDrawer').addEventListener('click', closeDrawer);
  $('scrim').addEventListener('click', closeDrawer);
  document.querySelectorAll('#drawerTabs [data-tab]').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));

  $('collapseSide').addEventListener('click', () => {
    document.querySelector('.side').classList.add('closed');
    document.querySelector('.app').classList.add('side-closed');
    $('showSide').hidden = false;
  });
  $('showSide').addEventListener('click', () => {
    document.querySelector('.side').classList.remove('closed');
    document.querySelector('.app').classList.remove('side-closed');
    $('showSide').hidden = true;
  });

  $('voiceBtn').addEventListener('click', () => {
    const panel = $('voicePanel');
    panel.hidden = !panel.hidden;
    $('voiceBtn').setAttribute('aria-expanded', String(!panel.hidden));
  });

  $('clearHistory').addEventListener('click', e => {
    e.preventDefault();
    state.history = [];
    renderHistory();
    log('history', 'cleared');
  });

  /* ------------------------------------------------------------- mode */

  const ptab = $('ptabSwitch');
  ptab.querySelectorAll('[data-ptab]').forEach(b => {
    b.addEventListener('click', () => {
      state.ptab = b.dataset.ptab;
      ptab.querySelectorAll('[data-ptab]').forEach(x => x.classList.toggle('on', x === b));
      syncCompose();
      if (state.ptab === 'topic' && !$('topicText').value) {
        $('topicText').value = 'A short, warm conversation about why small AI models are useful on the edge. Ava is curious, Ben is enthusiastic.';
      }
    });
  });

  function syncCompose() {
    const single = state.mode === 'single';
    document.querySelectorAll('[data-compose]').forEach(p => {
      const kind = p.dataset.compose;
      p.hidden = single
        ? (state.ptab === 'script' ? kind !== 'single' : kind !== 'topic')
        : kind !== state.ptab;
    });
    ptab.hidden = false;
    $('composeTitle').textContent = state.ptab === 'script' ? 'Script' : 'Concept';
    // In Single + Concept there is no script to speak, so the button is hidden.
    const speakBtn = $('speak');
    if (speakBtn) speakBtn.hidden = (single && state.ptab === 'topic');
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    if (mode === 'podcast' && state.speakers.length < 2) {
      state.speakers.push({ id: 's2', name: 'Ava', presentation: 'feminine', voice: 'Fola', accent: ACCENTS[1] });
      state.script.push({ speakerId: 's2', text: 'Thanks, it is good to be here.' });
    }
    // In the room, a Concept (topic) drives the two-person performance by
    // default; a hand-written script stays available under Script.
    state.ptab = 'topic';
    document.querySelectorAll('#ptabSwitch [data-ptab]').forEach(b => {
      b.classList.toggle('on', b.dataset.ptab === 'topic');
    });
    layout(); renderCast(); renderScript(); syncCompose(); stopAll('mode');
    if (typeof renderDesignTargets === 'function') renderDesignTargets();
    log('mode', mode === 'single' ? 'companion' : 'room');
    updateStatus();
  }
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  /* ------------------------------------------------------------ scene */

  const SCENE_STORE = 'stick.scenes.v1';
  state.customScenes = (() => {
    try { return JSON.parse(localStorage.getItem(SCENE_STORE) || '[]'); } catch (e) { return []; }
  })();
  state.customActive = null;

  function saveScenes() {
    try { localStorage.setItem(SCENE_STORE, JSON.stringify(state.customScenes)); } catch (e) { /* ignore */ }
  }

  function renderSceneList() {
    const wrap = $('bgPresets');
    wrap.innerHTML = '';
    const items = Object.keys(SCENES).map(k => ({ id: k, name: k, builtin: true }))
      .concat(state.customScenes.map(c => ({ id: c.id, name: c.name, prompt: c.prompt, builtin: false })));
    items.forEach(item => {
      const cell = document.createElement('div');
      cell.className = 'scene-item';
      const b = document.createElement('button');
      b.className = 'scene-btn';
      b.dataset.scene = item.id;
      b.textContent = item.name;
      b.title = item.prompt || '';
      const active = item.builtin ? (state.scene === item.id && !state.customActive) : state.customActive === item.id;
      if (active) b.classList.add('on');
      b.addEventListener('click', () => {
        state.customActive = item.builtin ? null : item.id;
        if (item.builtin) applyScene(item.id);
        else if (item.spec) drawSpec(item.spec); else applyScene(null, item.prompt);
        renderSceneList();
        $('bgStatus').textContent = item.builtin ? item.name : 'Custom · ' + item.prompt;
        log('scene', item.name);
      });
      cell.appendChild(b);

      if (!item.builtin) {
        const del = document.createElement('button');
        del.className = 'scene-del';
        del.textContent = '×';
        del.title = 'Delete this scene';
        del.setAttribute('aria-label', 'Delete ' + item.name);
        del.addEventListener('click', ev => {
          ev.stopPropagation();
          state.customScenes = state.customScenes.filter(x => x.id !== item.id);
          saveScenes();
          if (state.customActive === item.id) {
            state.customActive = null;
            applyScene('paper');
            $('bgStatus').textContent = 'Deleted · back to paper';
          } else {
            $('bgStatus').textContent = 'Deleted “' + item.name + '”';
          }
          renderSceneList();
          log('scene', 'deleted ' + item.name);
        });
        cell.appendChild(del);
      }

      wrap.appendChild(cell);
    });
  }

  $('bgApply').addEventListener('click', () => {
    const prompt = $('bgPrompt').value.trim();
    if (!prompt) { $('bgPrompt').focus(); return; }
    const btn = $('bgApply');
    const status = $('bgStatus');
    btn.classList.add('is-loading');
    btn.textContent = 'Rendering…';
    status.classList.add('busy');
    status.textContent = 'Building scene…';
    setTimeout(async () => {
      try {
        let spec = null;
        const pv = providerPayload();
        // Always try the AI first. Health may not have loaded yet on a fresh
        // profile, so refresh it rather than using it as a gate.
        if (!tts.health) { try { await refreshHealth(); } catch (e) { /* offline */ } }
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 20000);
          const res = await fetch(API + '/api/scene', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, mode: state.mode, provider: pv }),
            signal: ctrl.signal,
          }).finally(() => clearTimeout(timer));
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.ok) spec = data.scene;
          else log('error', (data.error || 'scene AI failed') + ' — using a built-in scene.');
        } catch (err) {
          const aborted = err && err.name === 'AbortError';
          log('error', aborted
            ? 'Scene AI timed out — using the closest built-in scene.'
            : 'Scene AI unavailable (' + err.message + ') — using the closest built-in scene.');
        }
        if (spec) {
          drawSpec(spec);
        } else {
          applyScene(null, prompt);
        }
        const id = 'custom-' + prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
        if (!state.customScenes.some(c => c.id === id)) {
          state.customScenes.push({
            id,
            name: (spec && spec.name ? spec.name : prompt).slice(0, 26),
            prompt,
            spec: spec || null,
          });
          saveScenes();
        }
        state.customActive = id;
        renderSceneList();
        status.textContent = spec
          ? `Generated “${spec.name || prompt}” · ${spec.elements.length} elements · saved`
          : `Added “${prompt.slice(0, 40)}” · built-in ${state.scene} · saved`;
        log('scene', spec ? `AI generated "${prompt}"` : `keyword-mapped "${prompt}" → ${state.scene}`);
      } catch (err) {
        status.textContent = 'Failed: ' + err.message;
        log('error', 'scene failed: ' + err.message);
      } finally {
        btn.classList.remove('is-loading');
        btn.textContent = 'Apply';
        status.classList.remove('busy');
      }
    }, 260);
  });

  renderSceneList();

  /* --------------------------------------------------------- providers */

  const STORE = 'stick.providers.v1';
  function loadProviders() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return [
      { id: 'p1', kind: 'tts', name: 'Gemini', model: 'gemini-3.8-flash-lite-tts', voice: 'Charon', key: '', active: true },
      { id: 'p2', kind: 'llm', name: 'Mercury', base: 'https://api.inceptionlabs.ai/v1', model: 'mercury-3', key: '', active: true },
    ];
  }
  function saveProviders() {
    try { localStorage.setItem(STORE, JSON.stringify(state.providers)); } catch (e) { /* ignore */ }
  }
  function renderProviders() {
    const wrap = $('providerList');
    wrap.innerHTML = '';
    const order = state.providers.slice().sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
    order.forEach(p => {
      const row = document.createElement('div');
      row.className = 'provider' + (p.active ? ' active' : '');
      row.innerHTML = `<span class="name"></span><span class="kind">${p.kind === 'tts' ? 'speech' : 'planner'}</span>
        ${p.active ? '<span class="badge">active</span>' : '<button class="ghost small use">Use</button>'}
        <button class="ghost small del">×</button>`;
      row.querySelector('.name').textContent = p.name + (p.model ? ' · ' + p.model : '');
      row.querySelector('.del').addEventListener('click', () => {
        state.providers = state.providers.filter(x => x.id !== p.id);
        if (!state.providers.some(x => x.kind === p.kind && x.active)) {
          const next = state.providers.find(x => x.kind === p.kind);
          if (next) next.active = true;
        }
        saveProviders(); renderProviders();
      });
      const use = row.querySelector('.use');
      if (use) use.addEventListener('click', () => {
        state.providers.forEach(x => { if (x.kind === p.kind) x.active = (x.id === p.id); });
        saveProviders(); renderProviders();
        log('provider', p.name + ' active');
      });
      wrap.appendChild(row);
    });
  }
  $('pvSave').addEventListener('click', () => {
    const name = $('pvName').value.trim() || 'Custom';
    const kind = $('pvKind').value;
    const p = {
      id: 'p' + Date.now(), kind, name,
      model: $('pvModel').value.trim() || (kind === 'tts' ? 'gemini-3.8-flash-lite-tts' : 'mercury-3'),
      voice: $('pvVoice').value.trim() || (kind === 'tts' ? 'Charon' : ''),
      base: $('pvBase').value.trim(),
      key: $('pvKey').value.trim(),
      active: !state.providers.some(x => x.kind === kind),
    };
    state.providers.push(p);
    saveProviders(); renderProviders();
    ['pvName', 'pvModel', 'pvVoice', 'pvBase', 'pvKey'].forEach(id => { $(id).value = ''; });
    log('provider', name + ' saved');
  });

  /* ----------------------------------------------------------- controls */

  $('speak').addEventListener('click', speakDirect);
  $('speakActions').addEventListener('click', speakWithActions);
  $('stop').addEventListener('click', () => stopAll('stopped'));
  $('sing').addEventListener('click', sing);
  $('act').addEventListener('click', performActions);
  $('mute').addEventListener('change', e => tts.setMuted(e.target.checked));
  $('addSpeaker').addEventListener('click', addSpeaker);
  $('zoomIn').addEventListener('click', () => nudgeZoom(ZOOM_STEP));
  $('zoomOut').addEventListener('click', () => nudgeZoom(-ZOOM_STEP));

  /* ------------------------------------------------------------ record */
  // Capture the stage as a WebM video and hand it to the user as a download.
  // We rasterise the live <svg> into a canvas each frame so the recording
  // matches what is on screen (background, figures, props, effects).
  let recorder = null;
  async function startRecording() {
    const btn = $('recordBtn');
    if (recorder) {  // stop
      btn.textContent = '⏳ Saving…';
      try {
        const blob = await recorder.stop();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `stick-${state.mode}-${stamp}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        log('record', `video downloaded (${Math.round(blob.size / 1024)} KB)`);
      } catch (e) {
        log('error', 'recording failed: ' + e.message);
      }
      recorder = null;
      btn.classList.remove('recording');
      btn.textContent = '⏺ Record';
      return;
    }
    const scene = SCENES[state.scene] || SCENES.paper;
    try {
      recorder = window.StickRecorder.start({
        svg,
        width: 1280,
        height: 960,
        fps: 30,
        background: scene.sky,
      });
      btn.classList.add('recording');
      btn.textContent = '⏹ Stop';
      log('record', 'recording — press Stop to save the video');
    } catch (e) {
      recorder = null;
      log('error', 'could not start recording: ' + e.message);
    }
  }
  $('recordBtn').addEventListener('click', startRecording);
  document.querySelectorAll('#zoomBar .preset').forEach(b => {
    b.addEventListener('click', () => {
      state.zoom = parseFloat(b.dataset.zoom);
      applyZoom();
      // collapse the size group again once a size is chosen
      const z = $('zoomBar');
      if (z) z.classList.remove('sizes-open');
      const sb = $('sizeBtn');
      if (sb) sb.setAttribute('aria-expanded', 'false');
    });
  });
  // The entire transport bar lives behind one gear button.
  if ($('gearBtn')) {
    $('gearBtn').addEventListener('click', ev => {
      ev.stopPropagation();
      const z = $('zoomBar');
      const open = z.classList.toggle('open');
      $('gearBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  // S/M/L live behind one small icon button.
  if ($('sizeBtn')) {
    $('sizeBtn').addEventListener('click', ev => {
      ev.stopPropagation();
      const z = $('zoomBar');
      const open = z.classList.toggle('sizes-open');
      $('sizeBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  document.querySelectorAll('#styleSwitch [data-style]').forEach(b => {
    b.addEventListener('click', () => {
      state.style = b.dataset.style;
      document.querySelectorAll('#styleSwitch [data-style]').forEach(x => x.classList.toggle('on', x === b));
      layout();
      log('style', state.style);
    });
  });
  document.querySelectorAll('#bodySwitch [data-body]').forEach(b => {
    b.addEventListener('click', () => {
      state.body = b.dataset.body;
      document.querySelectorAll('#bodySwitch [data-body]').forEach(x => x.classList.toggle('on', x === b));
      layout();
      log('body', state.body);
    });
  });

  /* UI theme: minimal (default) or brutalist neomorphism. */
  document.querySelectorAll('#uiSwitch [data-ui]').forEach(b => {
    b.addEventListener('click', () => {
      const kind = b.dataset.ui;
      if (kind === 'neo') document.body.dataset.ui = 'neo';
      else delete document.body.dataset.ui;
      try { localStorage.setItem('stick.ui.v1', kind); } catch (e) { /* ignore */ }
      document.querySelectorAll('#uiSwitch [data-ui]').forEach(x => x.classList.toggle('on', x === b));
      log('ui', kind);
    });
  });
  try {
    const savedUi = localStorage.getItem('stick.ui.v1');
    if (savedUi === 'neo') {
      document.body.dataset.ui = 'neo';
      const btn = document.querySelector('#uiSwitch [data-ui="neo"]');
      if (btn) {
        document.querySelectorAll('#uiSwitch [data-ui]').forEach(x => x.classList.toggle('on', x === btn));
      }
    }
  } catch (e) { /* ignore */ }

  /* ------------------------------------------------- length (short/medium/long) */
  state.length = 'medium';
  const LENGTH_STYLE = {
    short:  { note: 'one line', maxBeats: 1, maxChars: 90 },
    medium: { note: 'a few beats', maxBeats: 3, maxChars: 220 },
    long:   { note: 'full scene', maxBeats: 6, maxChars: 600 },
  };
  document.querySelectorAll('#lengthSwitch [data-len]').forEach(b => {
    b.addEventListener('click', () => {
      state.length = b.dataset.len;
      document.querySelectorAll('#lengthSwitch [data-len]').forEach(x => x.classList.toggle('on', x === b));
      log('length', `${state.length} · ${LENGTH_STYLE[state.length].note}`);
    });
  });

  /* ------------------------------------------------------------ design */
  state.base = 'neutral';
  const BASES = {
    neutral:   { presentation: 'neutral',   hair: 'none', bodyColor: '#cfe0cf' },
    masculine: { presentation: 'masculine', hair: 'short', bodyColor: '#c3d3e2' },
    feminine:  { presentation: 'feminine',  hair: 'long', bodyColor: '#e9d9bd' },
  };
  /* Design applies to a chosen character (or all of them). */
  state.designTarget = 'all';
  function renderDesignTargets() {
    const wrap = $('designTarget');
    if (!wrap) return;
    wrap.innerHTML = '';
    const add = (val, label) => {
      const b = document.createElement('button');
      b.dataset.target = val;
      b.textContent = label;
      if (state.designTarget === val) b.classList.add('on');
      b.addEventListener('click', () => {
        state.designTarget = val;
        renderDesignTargets();
        log('design', 'target · ' + label);
      });
      wrap.appendChild(b);
    };
    add('all', 'All');
    if (state.mode !== 'single') state.speakers.forEach(sp => add(sp.id, sp.name));
  }

  // Which speaker ids a design change should affect.
  function designTargets() {
    if (state.designTarget === 'all') return state.speakers.map(s => s.id);
    return [state.designTarget];
  }

  function applyBase(kind) {
    const spec = BASES[kind] || BASES.neutral;
    const targets = designTargets();
    state.speakers.forEach(sp => {
      if (!targets.includes(sp.id)) return;
      sp.presentation = spec.presentation;
      sp.hair = spec.hair;
      sp.bodyColor = spec.bodyColor;
    });
    state.base = kind;
    layout();
  }
  document.querySelectorAll('#baseSwitch [data-base]').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#baseSwitch [data-base]').forEach(x => x.classList.toggle('on', x === b));
      applyBase(b.dataset.base);
      log('design', 'base · ' + b.dataset.base);
    });
  });

  function setLook(kind, value) {
    // per-character looks, so Ben can wear a crown without Ava getting one
    state.looks = state.looks || {};
    for (const id of designTargets()) {
      state.looks[id] = state.looks[id] || { wear: 'none', face: 'none' };
      state.looks[id][kind] = value;
      const v = state.views.get(id);
      if (v && v.setLook) v.setLook(kind, value);
    }
  }
  document.querySelectorAll('#wearSwitch [data-wear]').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#wearSwitch [data-wear]').forEach(x => x.classList.toggle('on', x === b));
      setLook('wear', b.dataset.wear);
      log('design', 'wear · ' + b.dataset.wear);
    });
  });
  document.querySelectorAll('#faceSwitch [data-face]').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#faceSwitch [data-face]').forEach(x => x.classList.toggle('on', x === b));
      setLook('face', b.dataset.face);
      log('design', 'face · ' + b.dataset.face);
    });
  });

  /* ------------------------------------------------------------ demo */
  /* ------------------------------------------------------------ demo */
  // Build the demo panel from the catalogue (demos.js) instead of hardcoded
  // buttons, so every studio animation is listed — including the ones we
  // honestly cannot perform, which are shown disabled with their reason.
  const DEMO_SCENE_ALIAS = {
    floatingHeads: 'heads', breakingNews: 'news', guidedTour: 'tour',
    pitch: 'pitchdeck', sunsetGlow: 'sunsetglow',
  };

  function buildDemoPanel() {
    const grid = document.querySelector('.demo-grid');
    if (!grid || !window.StickDemos) return;
    grid.innerHTML = '';
    for (const group of window.StickDemos.groups) {
      const col = document.createElement('div');
      col.className = 'demo-col';
      const head = document.createElement('div');
      head.className = 'demo-head';
      head.textContent = group.name;
      col.appendChild(head);
      for (const item of group.items) {
        const b = document.createElement('button');
        b.className = 'demo-item';
        b.textContent = item.label;
        b.title = item.supported === false
          ? 'Not supported yet — ' + (item.note || '')
          : (item.prompt || item.text || '');
        if (item.supported === false) {
          b.classList.add('unsupported');
          b.style.opacity = '0.45';
          b.style.cursor = 'not-allowed';
          b.addEventListener('click', () => log('demo', `${item.label}: ${item.note || 'not supported'}`));
        } else {
          b.addEventListener('click', () => runDemo(item));
        }
        col.appendChild(b);
      }
      grid.appendChild(col);
    }
  }

  async function runDemo(item) {
    // resolve either the renderer namespace or our internal scene key
    const sceneKey = item.scene ? (DEMO_SCENE_ALIAS[item.scene] || item.scene) : null;
    if (sceneKey && (SCENES[sceneKey])) applyScene(sceneKey);

    if (item.kind === 'speak') {
      if (state.mode === 'single') { $('text').value = item.text; renderScript(); }
      else { $('topicText').value = item.text; }
      await speakDirect();
      return;
    }
    if (item.kind === 'perform') {
      if (state.mode === 'single') { $('text').value = item.text; renderScript(); }
      else { $('topicText').value = item.text; }
      if (item.emotion) $('speakEmotion').value = item.emotion;
      if (item.gesture) $('speakGesture').value = item.gesture;
      await speakWithActions();
      return;
    }
    if (item.kind === 'action') {
      if (state.mode === 'single') { $('text').value = item.prompt; renderScript(); }
      else { $('topicText').value = item.prompt; }
      await performActions();
    }
  }
  buildDemoPanel();
  document.querySelectorAll('.demo-item[data-demo]').forEach(b => {
    b.addEventListener('click', async () => {
      const kind = b.dataset.demo;
      if (kind === 'speak') {
        $('text').value = b.dataset.text;
        renderScript();
        await speakDirect();
      } else if (kind === 'perform') {
        $('text').value = b.dataset.text;
        renderScript();
        if (b.dataset.emotion) $('speakEmotion').value = b.dataset.emotion;
        if (b.dataset.gesture) $('speakGesture').value = b.dataset.gesture;
        await speakWithActions();
      } else if (kind === 'action') {
        $('text').value = b.dataset.prompt;
        renderScript();
        await performActions();
      }
    });
  });


  /* Action = stage direction, not just speech. The director returns a beat
     sheet of physical scenarios; we stage each beat AND speak its line so the
     scene is audible as well as visible. */
  let actionStager = null;
  function getStager() {
    if (!actionStager && window.StickAction) {
      try {
        actionStager = window.StickAction.createStager({
          svg,
          getRig: () => (state.mode === 'podcast' ? rigFor(state.activeId) : rig1()),
          getPartner: () => {
            if (state.mode !== 'podcast' || state.speakers.length < 2) return null;
            const other = state.speakers.find(s => s.id !== state.activeId) || state.speakers[1];
            return state.rigs.get(other.id) || null;
          },
          // No onBubble: an Action's beats are also its spoken segments, so the
          // caption comes from setCurrentSegment() on the audio cue. Letting the
          // stager open its own bubble here is what put the caption ahead of the
          // highlighted row.
        });
      } catch (err) {
        log('error', 'Stager init failed: ' + err.message);
        return null;
      }
    }
    return actionStager;
  }

  async function performActions() {
    if (state.actionRun) { state.actionRun.cancelled = true; state.actionRun = null; }
    const stager = getStager();
    if (stager) stager.clear();

    const single = state.mode === 'single';
    const prompt = single
      ? (state.ptab === 'topic' ? $('topicText').value : $('text').value).trim()
      : (state.ptab === 'script'
        ? currentLines().map(r => `${(speakerById(r.speakerId) || state.speakers[0]).name}: ${r.text}`).join('\n')
        : $('topicText').value.trim());
    if (!prompt) { log('error', 'Describe a scene first — e.g. "walks to the board and explains photosynthesis".'); return; }

    const run = { cancelled: false };
    state.actionRun = run;
    state.segActive = null;
    hideBubble();
    setBusy(true, 'Directing…');

    let plan = null;
    try {
      const res = await fetch(API + '/api/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode: state.mode, provider: providerPayload() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) plan = data.action;
      else log('error', data.error || 'Director failed — using a basic gesture.');
    } catch (err) {
      log('error', 'Director unreachable (' + err.message + ') — using a basic gesture.');
    }

    // Fallback: still do something physical rather than nothing.
    if (!plan || !plan.beats || !plan.beats.length) {
      const g = $('speakGesture').value;
      const rig = state.mode === 'podcast' ? rigFor(state.activeId) : rig1();
      rig.gesture(g === 'none' ? 'wave' : g);
      showBubble(g === 'none' ? 'Watch this.' : (STICK.companion.GESTURE_LABELS[g] || g), state.activeId, 2000);
      state.actionRun = null;
      setBusy(false);
      updateStatus();
      return;
    }

    log('action', `“${plan.title}” — ${plan.beats.length} beats`);

    try {
      /* Continuous performance: one audio stream plays every line back to back
         while the staging fires on its own clock. Previously each beat awaited
         its own speech, which produced the action → pause → speech → pause
         rhythm and let one voice read every part. */

      // 1. Assign a speaker to every beat that has words. Alternate over the
      //    TEXT beats only (not all beats) so both people actually talk.
      const cast = state.mode === 'podcast' ? state.speakers : [state.speakers[0]];
      let textIdx = 0;
      const beats = plan.beats.map(b => {
        const out = { ...b, at: 0 };
        if (b.text) {
          let spk = b.speaker ? findSpeakerByName(b.speaker) : null;
          if (!spk && cast.length > 1) spk = cast[textIdx % cast.length];
          if (!spk) spk = cast[0];
          out._speaker = spk;
          textIdx++;
        }
        return out;
      });

      // 2. Lay out the beat sheet on one timeline and stage it with
      //    stager.schedule(). This is the arrangement that produced a smooth,
      //    properly paced performance; driving it per audio cue made the beats
      //    arrive late and pile up.
      let clock = 0;
      for (const b of beats) {
        b.at = clock;
        const spoken = b.text ? Math.max(1.6, b.text.length * 0.062) : (b.hold || 1.6);
        b.dur = spoken;
        clock += spoken;
      }
      if (stager) {
        if (stager.schedule) stager.schedule(beats);
        else beats.forEach(b => setTimeout(() => {
          if (!run.cancelled) stager.play({ scenario: b.scenario, text: b.text || '', title: plan.title, at: 0 });
        }, b.at * 1000));
      }

      // 4. Speak everything as ONE segment stream so the voices alternate and
      //    there is no dead air between lines.
      const spokenBeats = beats.filter(b => b.text);
      if (spokenBeats.length) {
        const emotionFor = b => (b.scenario === 'clash' || b.scenario === 'fight' || b.scenario === 'faceoff') ? 'angry'
          : b.scenario === 'dance' ? 'happy'
          : b.scenario === 'think' ? 'thinking'
          : b.scenario === 'present' || b.scenario === 'lecture' ? 'confident'
          : 'neutral';
        const segs = spokenBeats.map(b => ({
          text: b.text,
          speaker_id: b._speaker.id,
          voice: b._speaker.voice,
          emotion: emotionFor(b),
          intensity: 1,
          gesture: null,
          pause_after_ms: 90,
        }));
        renderTimeline(segs.map((s, i) => ({ ...s, index: i })));
        state.segMeta = segs.map(s => ({ ...s }));
        state.segBeats = null;   // beats are scheduled, not cued
        // the first bubble opens with the first audio cue, not before it
        await tts.speak({
          segments: segs,
          model: $('model').value,
          mode: state.mode,
          provider: providerPayload(),
          speakers: state.speakers.map(s => ({ id: s.id, name: s.name, voice: s.voice })),
        });
        if (tts.lastError) {
          const msg = String(tts.lastError.message || '');
          if (/quota/i.test(msg)) {
            state.voiceDownUntil = Date.now() + 90_000;
            log('voice', 'TTS quota exhausted — switching to local playback for 90s');
          }
          synthetic(segs);
        }
      } else {
        // purely physical scene: just let the staging run for its full length
        await new Promise(r => setTimeout(r, Math.min(clock * 1000, 20000)));
      }
      await new Promise(r => setTimeout(r, 500));
    } finally {
      if (state.actionRun === run) state.actionRun = null;
      flushActionTake();
      setBusy(false);
      updateStatus();
    }
  }

  // Resolve a director-supplied speaker name to a cast member.
  function findSpeakerByName(name) {
    if (!name) return null;
    const n = String(name).trim().toLowerCase();
    return state.speakers.find(s => s.name.toLowerCase() === n)
        || state.speakers.find(s => n.includes(s.name.toLowerCase()))
        || null;
  }

  async function sing() {
    const text = (state.mode === 'single' ? $('text').value : $('topicText').value) || 'La la la.';
    const rig = rigFor(state.activeId);
    rig.emote('music', 2200);
    if (!tts.canSpeak) { rig.setSinging(true); return; }
    await tts.speak({ text, style: 'sung, melodic', emotion: 'happy', intensity: 1, voice: $('voice').value, model: $('model').value, mode: state.mode, provider: providerPayload(), speakers: state.speakers.map(s => ({ id: s.id, name: s.name, voice: s.voice })) });
  }

  ['speakEmotion'].forEach(id => {
    STICK.companion.EMOTION_NAMES.forEach(n => {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      $(id).appendChild(o);
    });
  });
  STICK.companion.GESTURE_NAMES.forEach(n => {
    const o = document.createElement('option');
    o.value = n; o.textContent = (STICK.companion.GESTURE_LABELS[n] || n).toLowerCase();
    $('speakGesture').appendChild(o);
  });

  /* --------------------------------------------------------------- loop */

  let last = performance.now();
  let hudAt = 0;

  function frame(now) {
    const t = now / 1000;
    const dt = (now - last) / 1000;
    last = now;
    if (state.localPlan) {
      const elapsed = t - state.localPlan.start;
      while (state.localPlan && state.localPlan.i < state.localPlan.schedule.length
             && elapsed >= state.localPlan.schedule[state.localPlan.i].at) {
        const seg = state.localPlan.schedule[state.localPlan.i++].seg;
        applySegment({ ...seg, index: state.localPlan.i - 1 });
      }
      const plan = state.localPlan;
      const lastSeg = plan.schedule[plan.schedule.length - 1];
      // Keep the last line's bubble up for its own duration, then settle the row.
      const end = lastSeg.at + (lastSeg.dur || 0);
      if (elapsed > end + 1.2) {
        state.localPlan = null;
        hideBubble();
        state.segActive = null;
        for (const li of $('timeline').querySelectorAll('li[data-status="playing"]')) {
          markSegment(+li.dataset.index, 'done');
        }
      }
    }
    for (const [id, rig] of state.rigs) {
      rig.step(dt, t);
      const view = state.views.get(id);
      if (view) view.draw(t);
      // the name tag travels with its figure
      const label = state.labels.get(id);
      if (label && rig.pose) {
        const head = rig.pose.world.head;
        const r = rig.pose.g.headR;
        label.setAttribute('x', head.x.toFixed(2));
        label.setAttribute('y', (state.body === 'bust' ? head.y + r * 1.5 : 86.6).toFixed(2));
      }
    }

    // Keep the performers apart. Without this they drift into the same spot
    // ("one behind the other") whenever an action or drag moves them.
    if (state.rigs.size > 1) {
      const MIN_GAP = 24;
      const list = [...state.rigs.values()].sort((a, b) => (a.baseX || 0) - (b.baseX || 0));
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        const d = (b.baseX || 0) - (a.baseX || 0);
        if (d < MIN_GAP) {
          const push = (MIN_GAP - d) / 2 + 0.5;
          a.baseX = Math.max(8, (a.baseX || 0) - push);
          b.baseX = Math.min(92, (b.baseX || 0) + push);
        }
      }
    }
    tts.pump();
    if (!bubble.hidden) {
      positionBubble();
      if (performance.now() > bubbleUntil) hideBubble();
    }
    if (now - hudAt > 200) { hudAt = now; updateStatus(); }
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------- transport */
  state.paused = false;
  state.speed = 1;
  function setPlayIcon() {
    const b = $('playPause');
    if (b) b.textContent = state.paused ? '▶' : '❚❚';
  }
  if ($('playPause')) {
    $('playPause').addEventListener('click', () => {
      state.paused = !state.paused;
      const ctx = tts.ctx;
      if (ctx) { state.paused ? ctx.suspend() : ctx.resume(); }
      setPlayIcon();
      log('transport', state.paused ? 'paused' : 'playing');
    });
  }
  if ($('speedSel')) {
    $('speedSel').addEventListener('change', e => {
      state.speed = parseFloat(e.target.value) || 1;
      const ctx = tts.ctx;
      if (ctx && 'playbackRate' in ctx) { try { ctx.playbackRate.value = state.speed; } catch (err) { /* ignore */ } }
      log('transport', `${state.speed}× speed`);
    });
  }
  if ($('fullBtn')) {
    $('fullBtn').addEventListener('click', () => {
      const target = document.getElementById('stageArea') || document.documentElement;
      if (!document.fullscreenElement) {
        if (target.requestFullscreen) target.requestFullscreen().catch(() => log('transport', 'full screen blocked'));
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }
  setPlayIcon();

  /* ------------------------------------------------- timeline scrubber */
  // The scrubber shows position across the last performance and lets you jump
  // to any line. Seeking replays the cached take from that segment, so it works
  // fully offline with no new provider calls.
  state.playhead = 0;          // 0..1
  state.takeAt = 0;            // index of the segment currently playing
  state.lastTake = null;       // {segments, capture}

  function totalSegments() {
    return (state.lastTake && state.lastTake.capture && state.lastTake.capture.length) || 0;
  }
  function paintScrub() {
    const s = $('scrub');
    if (!s) return;
    const n = totalSegments();
    if (!n) { s.value = 0; return; }
    s.value = String(Math.round((state.playhead || 0) * 100));
  }
  function seekToSegment(i) {
    const take = state.lastTake;
    if (!take || !take.capture || !take.capture.length) {
      log('transport', 'nothing to seek — play something first');
      return;
    }
    const n = take.capture.length;
    const idx = Math.max(0, Math.min(n - 1, i));
    state.takeAt = idx;
    state.playhead = idx / n;
    paintScrub();
    tts.playCached({
      segments: take.segments.slice(idx),
      capture: take.capture.slice(idx),
    }).catch(() => {});
    log('transport', `jumped to line ${idx + 1}/${n}`);
  }
  if ($('seekBack')) $('seekBack').addEventListener('click', () => seekToSegment((state.takeAt || 0) - 1));
  if ($('seekFwd')) $('seekFwd').addEventListener('click', () => seekToSegment((state.takeAt || 0) + 1));
  if ($('scrub')) {
    $('scrub').addEventListener('change', e => {
      const n = totalSegments();
      if (!n) return;
      const pct = parseFloat(e.target.value) / 100;
      seekToSegment(Math.round(pct * (n - 1)));
    });
  }

  requestAnimationFrame(frame);

  /* ------------------------------------------------------- drag to move */
  // Drag a character anywhere on the stage; on release they walk to that spot
  // and carry on acting from there.
  let drag = null;
  const stagePoint = ev => {
    const r = svg.getBoundingClientRect();
    const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    return {
      x: vb[0] + ((ev.clientX - r.left) / r.width) * vb[2],
      y: vb[1] + ((ev.clientY - r.top) / r.height) * vb[3],
    };
  };
  svg.addEventListener('pointerdown', ev => {
    const root = ev.target.closest && ev.target.closest('.character');
    if (!root) return;
    const id = root.getAttribute('data-rig');
    const rig = state.rigs.get(id);
    if (!rig) return;
    // Arm a drag candidate, but do NOT capture or preventDefault yet: a tap must
    // still reach the rig so a single tap tickles the character.
    drag = {
      id, rig, root, engaged: false,
      startX: ev.clientX, startY: ev.clientY,
      ghostX: rig.baseX, pointerId: ev.pointerId, lastX: rig.baseX,
    };
  });
  svg.addEventListener('pointermove', ev => {
    if (!drag) return;
    // A real drag starts only after the pointer travels a few pixels.
    if (!drag.engaged) {
      const dx = Math.abs(ev.clientX - drag.startX);
      const dy = Math.abs(ev.clientY - drag.startY);
      if (dx < 6 && dy < 6) return;
      drag.engaged = true;
      drag.root.classList.add('dragging');
      try { svg.setPointerCapture(drag.pointerId); } catch (e) { /* ignore */ }
    }
    const p = stagePoint(ev);
    drag.rig.baseX = Math.max(8, Math.min(92, p.x));
    drag.lastX = p.x;
  });
  const endDrag = () => {
    if (!drag) return;
    const { id, rig, engaged, lastX, root } = drag;
    if (root) root.classList.remove('dragging');
    drag = null;
    // A tap (never engaged) is handled by the rig itself -> tickle/express.
    if (!engaged) return;
    const others = [];
    for (const [oid, or] of state.rigs) {
      if (oid === id) continue;
      if (or.baseX != null) others.push(or.baseX);
    }
    rig.goTo(lastX == null ? rig.baseX : lastX, { speed: 30, avoid: others });
    log('move', `walked to x=${Math.round(lastX)}`);
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // Double-click anywhere on the stage sends the active character to that spot.
  // Single tap stays a tickle; dragging still repositions directly.
  svg.addEventListener('dblclick', ev => {
    const rig = state.mode === 'podcast' ? rigFor(state.activeId) : rig1();
    if (!rig) return;
    const p = stagePoint(ev);
    const others = [];
    for (const [oid, or] of state.rigs) {
      if (or === rig) continue;
      if (or.baseX != null) others.push(or.baseX);
    }
    rig.goTo(p.x, { speed: 34, avoid: others });
    log('move', 'double-click → walked to x=' + Math.round(p.x));
  });

  function updateStatus() {
    const rig = rig1();
    if (!rig) return;
    if (state.busy) return;
    const s = rig.state();
    const bits = [];
    const who = state.mode === 'podcast' && state.activeId ? (speakerById(state.activeId) || {}).name : null;
    if (state.mode === 'podcast' && who) bits.push(who);
    bits.push(s.emotion);
    if (s.singing) bits.push('singing');
    else if (s.speaking) bits.push('speaking');
    $('status').textContent = bits.join(' · ');
  }

  /* -------------------------------------------------------------- boot */

  state.providers = loadProviders();
  layout();
  renderCast();
  renderScript();
  syncCompose();
  renderProviders();
  renderDesignTargets();
  // Start on Concept with a ready-to-run example, so the first thing you see is
  // something you can press Play on rather than an empty box.
  if ($('topicText') && !$('topicText').value.trim()) {
    $('topicText').value =
      'A short, warm conversation about why small AI models are useful on the edge. '
      + 'Ben is curious and asks the questions; Ava is enthusiastic and explains.';
  }
  applyScene('standup');
  // Start the performers in a good mood rather than blank neutral.
  for (const rig of state.rigs.values()) {
    try { rig.setEmotion('happy', { intensity: 1, duration: 0.01 }); } catch (e) { /* ignore */ }
  }
  fillModels();
  refreshHealth().then(() => log('ready', 'studio ready'));
  setInterval(() => { if (!tts.health) refreshHealth(); }, 6000);
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') { closeDrawer(); stopAll('esc'); }
    if (e.key === ' ') { e.preventDefault(); speakDirect(); }
  });
  window.Companion = {
    tts, state, setMode, stop: stopAll, applyScene,
    get rig() { return rig1(); },
    get rigs() { return state.rigs; },
    get mode() { return state.mode; },
    get segments() { return state.segments; },
    get history() { return state.history; },
    speak: opts => tts.speak({ ...opts, provider: providerPayload() }),
    send: ev => rig1().apply(ev),
    emotions: STICK.companion.EMOTION_NAMES,
    gestures: STICK.companion.GESTURE_NAMES,
  };
})();


