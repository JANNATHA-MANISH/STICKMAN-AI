/* stick companion â€” a persistent, layered rig built on the stock engine.
 *
 * The stock player compiles a whole JSON timeline up front and samples it at
 * a time t. A companion needs the opposite: one character that never resets,
 * whose layers (emotion, gesture, speech, gaze, idle) blend continuously.
 *
 * This file leaves the engine's pure pose function (STICK.computeFigure) and
 * the drawing styles (STICK.styles.*) untouched. It only replaces the *source*
 * of channel values: instead of sampling compiled tweens it feeds the same
 * named channels (smile, eyeOpen, shR, mouthOpen, pupX, â€¦) from a smoothed,
 * additive layer stack. computeFigure still does the skeleton, IK, gait and
 * automatic blinking; styles.js still draws.
 *
 * Every emotion is taken from STICK.presets.moods, and the built-in clip
 * library (wave, bow, victory, hopJoy, â€¦) is compiled once through the real
 * command engine and sampled into gesture tracks â€” so the prototype has the
 * repo's full vocabulary, not a hand-picked subset.
 *
 * Upstream: https://github.com/hmelberg/stick (no licence file is present in
 * the upstream repository â€” see NOTICE.md). Original engine Â© its author.
 */
(function () {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;
  const STICK = (G.STICK = G.STICK || {});
  const clamp = STICK.clamp;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  const FACE = ['smile', 'eyeOpen', 'browTilt', 'browRaise', 'mouthOpen', 'browSkew', 'tears', 'blush'];
  const FACE_BLEND = new Set(FACE);
  const POSTURE = ['bend', 'lean', 'headTilt'];
  const ARMS = ['shL', 'shR', 'elL', 'elR'];

  // Every mood the repo ships, in a sensible order for the UI.
  // 'concerned' is a prototype alias for 'worried' (same face, softer name).
  if (STICK.presets.moods.worried) STICK.presets.moods.concerned = STICK.presets.moods.worried;
  const EMOTION_NAMES = ['neutral', 'happy', 'ecstatic', 'laughing', 'love', 'proud',
    'surprised', 'scared', 'worried', 'concerned', 'confused', 'thinking',
    'sad', 'crying', 'bored', 'sleepy', 'angry', 'disgusted', 'embarrassed']
    .filter(m => STICK.presets.moods[m]);

  const FIG_DEFAULTS = {
    id: 'companion', name: 'Pip', style: 'sketch', facing: 0,
    height: 44, headScale: 1.12, pos: { x: 50, y: 80 }, mood: 'neutral', age: 'adult',
  };
  const BASE_Y = FIG_DEFAULTS.pos.y;

  /* ---------------------------------------------------------------- helpers */

  function hash01(n) {
    const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return v - Math.floor(v);
  }
  // Per-figure PRNG (LCG): every companion gets its own idle rhythm, so a
  // group never synchronises â€” and the loop stays reproducible under a test.
  function makeRng(seed) {
    let s = ((seed * 2654435761) % 4294967296) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }
  const easeOf = name => STICK.EASE[name] || STICK.EASE.inOut;

  /* Sample a keyframe track: [[t, value, easeName?], â€¦].
     Strings are stepped (hand shapes); numbers are eased. */
  function sampleTrack(track, t) {
    if (!track || !track.length) return 0;
    if (t <= track[0][0]) return track[0][1];
    for (let i = 1; i < track.length; i++) {
      const [t1, v1, ez] = track[i];
      if (t <= t1) {
        const [t0, v0] = track[i - 1];
        if (typeof v0 === 'string' || typeof v1 === 'string') return t >= t1 ? v1 : v0;
        const u = clamp((t - t0) / Math.max(1e-6, t1 - t0), 0, 1);
        return STICK.lerp(v0, v1, easeOf(ez)(u));
      }
    }
    return track[track.length - 1][1];
  }

  /* Synthetic jaw envelope for text that has no audio (no key / TTS off). */
  function speechLevel(t, seed) {
    const step = 0.135;
    const i = Math.floor(t / step);
    const r = hash01(seed + i * 7.13);
    const open = 0.16 + 0.8 * Math.pow(r, 0.7);
    return clamp(open * (0.86 + 0.14 * Math.sin(2 * Math.PI * 0.33 * t + seed)), 0, 1);
  }

  /* ------------------------------------------------------------- emotions */

  // Built from the repository's own mood presets, so the prototype stays in
  // sync if upstream tunes them. `neutral` is the baseline every intensity
  // blend is measured against (the same maths as the `mood` command).
  const EMOTIONS = {};
  EMOTION_NAMES.forEach(name => {
    const m = STICK.presets.moods[name];
    EMOTIONS[name] = {
      name,
      expr: Object.assign({}, STICK.presets.moods.neutral.expr, m.expr),
      pose: Object.assign({}, STICK.presets.moods.neutral.pose, m.pose),
      life: Object.assign({}, STICK.presets.moods.neutral.idle, m.idle),
    };
  });
  const NEUTRAL = EMOTIONS.neutral;

  // A small flourish when an emotion is chosen (sparingly: only once on entry).
  const EMOTION_EMOTE = {
    love: 'heart', sleepy: 'zzz', laughing: 'sparkle', thinking: 'dots',
    confused: 'question', surprised: 'exclaim', crying: 'sweat',
  };
  // Some moods have a signature clip that sells them far better than the face.
  const EMOTION_GESTURE = { thinking: 'thinkChin' };

  // Named emotes → the glyph drawn next to the head.
  const EMOTE_GLYPH = {
    music: '♪', note: '♪', idea: '💡', bulb: '💡', heart: '♥', love: '♥',
    sparkle: '✦', star: '★', question: '?', exclaim: '!', dots: '…',
    zzz: 'zzz', sleep: 'zzz', sweat: '💧',
  };

  /* ------------------------------------------------------- clip â†’ gesture */

  // Channels a clip may touch that we deliberately do not replay as a gesture
  // (identity / locomotion / pinning are owned by the rig).
  const CLIP_EXCLUDE = new Set(['x', 'facing', 'mood', 'sit', 'crouch', 'lie',
    'pinFL', 'pinFR', 'reachLon', 'reachLx', 'reachLy', 'reachRon', 'reachRx', 'reachRy']);
  const DECIMAL = new Set(['smile', 'eyeOpen', 'mouthOpen', 'browTilt', 'browRaise',
    'browSkew', 'tears', 'blush', 'bend', 'lean', 'headTilt', 'tilt', 'stanceW']);

  /* Compile one built-in clip with the real command engine, then sample the
     resulting channels into keyframes. This is how every clip becomes a live
     gesture with the repo's own timing and easing. */
  function clipToGesture(name) {
    const doc = {
      figures: [Object.assign({}, FIG_DEFAULTS, { id: 'clip' })],
      timeline: [{ target: 'clip', cmd: 'playClip', args: { name } }],
    };
    const rt = STICK.compile(doc);
    let end = 0;
    for (const [key, c] of rt.ch.m) {
      if (!key.startsWith('clip.') || !c.tracks.length) continue;
      for (const tr of c.tracks) end = Math.max(end, tr.t1);
    }
    const ch = {};
    const EPS = 1 / 60;
    for (const [key, c] of rt.ch.m) {
      if (!key.startsWith('clip.') || !c.tracks.length) continue;
      const chName = key.slice(5);
      if (CLIP_EXCLUDE.has(chName)) continue;
      const eps = DECIMAL.has(chName) ? 0.008 : chName === 'y' ? 0.04 : 0.4;
      const pts = [];
      let prev = null;
      for (let i = 0; i * EPS <= end + 1e-9; i++) {
        const t = +(i * EPS).toFixed(3);
        const v = rt.ch.getDef(key, t, 0);
        if (typeof v === 'string') {
          if (!pts.length || pts[pts.length - 1][1] !== v) pts.push([t, v]);
          prev = v;
        } else if (prev === null || Math.abs(v - prev) > eps) {
          pts.push([t, +v.toFixed(2)]);
          prev = v;
        }
      }
      if (pts.length > 1) ch[chName] = pts;
    }
    return { dur: end, ch, source: 'clip:' + name };
  }

  // Hand-written because the repo has no cough clip. Same keyframe format.
  const COUGH = {
    dur: 1.6,
    ch: {
      bend: [[0, 0], [0.28, 0.20, 'out'], [0.44, 0.07], [0.58, 0.22, 'out'], [0.74, 0.06], [0.95, 0.12], [1.5, 0]],
      headTilt: [[0, 0], [0.28, 0.16], [0.6, 0.18], [1.0, 0.07], [1.5, 0]],
      shR: [[0, 0], [0.22, 128], [1.0, 124], [1.5, 0]],
      elR: [[0, 8], [0.22, 148], [1.0, 144], [1.5, 8]],
      handR: [[0, 'relaxed'], [0.2, 'fist'], [1.4, 'relaxed']],
    },
    mouth: [[0, 0], [0.28, 0.45], [0.36, 0.04], [0.46, 0.5], [0.54, 0.05], [0.62, 0.4], [0.7, 0.02], [1.5, 0]],
  };

  const GESTURE_LABELS = {
    wave: 'Wave', nod: 'Nod', cough: 'Cough', clapOnce: 'Clap', shrugOnce: 'Shrug',
    scratchHead: 'Scratch head', bow: 'Bow', hopJoy: 'Hop', facepalm: 'Facepalm',
    stretchYawn: 'Stretch & yawn', thinkChin: 'Think', victory: 'Victory',
    phoneCall: 'Phone', coolLean: 'Cool lean', head_tilt: 'Head tilt', head_nod: 'Head nod',
    run: 'Run', fight: 'Fight', handshake: 'Handshake', dance: 'Dance', beat: 'Beat',
    walk: 'Walk', walkTalk: 'Walk & talk', walkThink: 'Walk & think', point: 'Point', jump: 'Jump',
    slap: 'Slap', kick: 'Kick', hug: 'Hug', kiss: 'Kiss',
  };

  const GESTURES = {};
  Object.keys(STICK.presets.clips).forEach(name => {
    if (name === 'clap' || name === 'shrug') return;         // aliases of clapOnce/shrugOnce
    GESTURES[name] = clipToGesture(name);
  });
  GESTURES.cough = COUGH;
  // Two extra "shape only" gestures that the speech protocol names explicitly.
  GESTURES.head_tilt = { dur: 1.8, ch: { headTilt: [[0, 0], [0.45, 0.2, 'out'], [1.2, 0.17], [1.8, 0]], lean: [[0, 0], [0.45, 0.01], [1.8, 0]] } };
  GESTURES.head_nod = GESTURES.nod;

  // Looping actions (authored, since the repo clips are one-shot poses).
  const osc = (dur, amp, cycles, phase, base) => {
    const n = Math.max(6, Math.round(cycles * 8));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const v = (i === 0 || i === n) ? base : base + amp * Math.sin(2 * Math.PI * cycles * u + phase);
      pts.push([+(u * dur).toFixed(3), +v.toFixed(2)]);
    }
    return pts;
  };

  GESTURES.fight = {
    dur: 1.7,
    ch: {
      lean: [[0, 0], [0.2, 0.08], [1.4, 0.08], [1.7, 0]],
      shR: [[0, 0], [0.14, 96, 'out'], [0.3, 18], [0.48, 96, 'out'], [0.64, 18], [0.9, 0]],
      elR: [[0, 8], [0.14, 12], [0.3, 78], [0.48, 12], [0.64, 78], [0.9, 8]],
      shL: [[0, 0], [0.4, 22], [0.52, 88, 'out'], [0.68, 22], [0.9, 0]],
      elL: [[0, 8], [0.4, 70], [0.52, 14], [0.68, 70], [0.9, 8]],
      handL: [[0, 'relaxed'], [0.2, 'fist'], [0.85, 'fist'], [1.0, 'relaxed']],
      handR: [[0, 'relaxed'], [0.2, 'fist'], [0.85, 'fist'], [1.0, 'relaxed']],
      headTilt: [[0, 0], [0.2, 0.08], [1.3, 0.08], [1.7, 0]],
    },
  };

  GESTURES.handshake = {
    dur: 1.8,
    ch: {
      shR: [[0, 0], [0.28, 74, 'out'], [1.4, 70], [1.8, 0]],
      elR: [[0, 8], [0.28, 52], [1.4, 56], [1.8, 8]],
      lean: [[0, 0], [0.3, 0.05], [1.4, 0.05], [1.8, 0]],
      headTilt: [[0, 0], [0.3, -0.06], [1.2, -0.04], [1.8, 0]],
      y: [[0, 80], [0.45, 79.6], [0.62, 80], [0.8, 79.6], [1.0, 80], [1.8, 80]],
      handR: [[0, 'relaxed'], [0.25, 'open'], [1.5, 'open'], [1.8, 'relaxed']],
    },
  };

  GESTURES.dance = {
    dur: 2.4,
    ch: {
      hipL: osc(2.4, 20, 3, 0, 4), hipR: osc(2.4, 20, 3, Math.PI, 4),
      kneeL: osc(2.4, 26, 3, Math.PI / 2, 26), kneeR: osc(2.4, 26, 3, -Math.PI / 2, 26),
      shL: osc(2.4, 45, 3, 0, 22), shR: osc(2.4, 45, 3, Math.PI, 22),
      elL: osc(2.4, 25, 3, 0, 60), elR: osc(2.4, 25, 3, Math.PI, 60),
      headTilt: osc(2.4, 0.07, 3, 1.2, 0), lean: osc(2.4, 0.03, 3, 0, 0),
      y: osc(2.4, 0.8, 3, 0, 80), stanceW: [[0, 0], [0.3, 0.5], [2.1, 0.5], [2.4, 0]],
    },
  };

  GESTURES.beat = {
    dur: 2.0,
    ch: {
      shL: osc(2.0, 14, 4, 0, 26), shR: osc(2.0, 14, 4, Math.PI, 26),
      elL: osc(2.0, 10, 4, 0, 70), elR: osc(2.0, 10, 4, Math.PI, 70),
      headTilt: osc(2.0, 0.05, 4, 0, 0.02),
      y: osc(2.0, 0.45, 4, 0, 80),
      bend: osc(2.0, 0.02, 4, 0, 0.04),
    },
  };

  GESTURES.shy = {
    dur: 1.7,
    ch: {
      headTilt: [[0, 0], [0.3, 0.2, 'out'], [1.3, 0.16], [1.7, 0]],
      bend: [[0, 0], [0.3, 0.09], [1.3, 0.07], [1.7, 0]],
      shL: [[0, 0], [0.3, 30], [1.3, 28], [1.7, 0]],
      shR: [[0, 0], [0.3, 30], [1.3, 28], [1.7, 0]],
      elL: [[0, 8], [0.3, 98], [1.3, 96], [1.7, 8]],
      elR: [[0, 8], [0.3, 98], [1.3, 96], [1.7, 8]],
      handL: [[0, 'relaxed'], [0.3, 'fist'], [1.45, 'fist'], [1.7, 'relaxed']],
      handR: [[0, 'relaxed'], [0.3, 'fist'], [1.45, 'fist'], [1.7, 'relaxed']],
    },
  };

  const AUTO_GESTURE = {
    thinking: 'thinkChin', laughing: 'beat', ecstatic: 'victory',
    surprised: 'hopJoy',
  };

  // Walking conversations â€” the request for "walk while he talks/thinks".
  // Gait is driven by DISTANCE TRAVELLED, not by time (same principle as the
  // upstream engine's gaitOffsets): each unit of travel advances the step
  // phase, so feet plant instead of skating. `lift` clears the swing foot.
  const GAIT = {
    walk: { stride: 0.62, hip: 27, knee: 38, arm: 19, elbow: 10, elbowSwing: 7, bob: 0.017, lift: 0.035, footDown: 26, footUp: 15, lean: 3 },
    run:  { stride: 0.95, hip: 44, knee: 65, arm: 32, elbow: 70, elbowSwing: 0, bob: 0.045, lift: 0.085, footDown: 36, footUp: 18, lean: 9 },
  };

  // Build hip/knee/arm tracks for a walk of `dist` stage units over `dur`.
  // Sampling matches the engine: swing leg = hip sweeping forward, knee bends
  // and foot lifts only during swing; heel strike pitches the toe up.
  const walkCh = (dur, dist = 26, kind = 'walk') => {
    const p = GAIT[kind] || GAIT.walk;
    const steps = Math.max(2, Math.round(Math.abs(dist) / (p.stride * 8)));
    const dir = dist === 0 ? 0 : dist > 0 ? 1 : -1;   // side profile: +1 right, -1 left
    const N = 96;
    const tl = (vals, f) => {
      const out = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        out.push([+(u * dur).toFixed(4), f(u)]);
      }
      return out;
    };
    const phase = u => u * steps * Math.PI * 2;
    // The `lean` channel is in radians (~0.07 = a subtle 4Â° lean). The GAIT
    // table is in degrees, so convert â€” passing degrees folded the torso double.
    const leanRad = (p.lean || 0) * Math.PI / 180;
    const lean = [[0, 0], [dur * 0.15, leanRad], [dur * 0.85, leanRad], [dur, 0]];
    return {
      lean,
      hipL: tl(null, u => p.hip * Math.sin(phase(u))),
      hipR: tl(null, u => -p.hip * Math.sin(phase(u))),
      kneeL: tl(null, u => p.knee * Math.max(0, Math.cos(phase(u)))),
      kneeR: tl(null, u => p.knee * Math.max(0, -Math.cos(phase(u)))),
      shL: tl(null, u => -p.arm * Math.sin(phase(u))),
      shR: tl(null, u => p.arm * Math.sin(phase(u))),
      elL: tl(null, u => p.elbow + p.elbowSwing * Math.sin(phase(u) + 1)),
      elR: tl(null, u => p.elbow + p.elbowSwing * Math.sin(phase(u) + 1 + Math.PI)),
      // vertical bob: two bobs per stride (one per footfall)
      y: tl(null, u => 80 - Math.abs(Math.cos(phase(u))) * 0.55),
      x: [[0, 0], [dur, dist]],
      // Facing: the travel direction, held for the whole walk. The engine
      // mirrors the body group with scale(facing, 1), so +1 draws the figure in
      // right-facing side profile and -1 in left-facing side profile. Walking
      // at the viewer was the bug â€” the legs swung but the body stayed front-on.
      facing: [[0, dir], [dur, dir]],
    };
  };

  GESTURES.walk = { dur: 2.0, ch: walkCh(2.0, 26, 'walk'), locomote: 26 };
  GESTURES.walkBack = { dur: 2.0, ch: walkCh(2.0, -26, 'walk'), locomote: -26 };
  GESTURES.run = { dur: 1.3, ch: walkCh(1.3, 34, 'run'), locomote: 34 };
  // Moonwalk: the body travels BACKWARD while the feet step forward â€” the hips
  // sweep forward on the beat but x decreases, which is what sells the illusion.
  GESTURES.moonwalk = {
    dur: 2.4,
    locomote: -20,
    ch: (() => {
      const c = walkCh(2.4, -20, 'walk');
      c.x = [[0, 0], [2.4, -20]];
      // â€¦so he faces AWAY from travel, like upstream's autoFace does for the
      // moonwalk style: the feet step forward while the body slides back.
      c.facing = [[0, 1], [2.4, 1]];
      c.lean = [[0, 0], [0.3, -0.1], [2.1, -0.1], [2.4, 0]];
      c.headTilt = [[0, 0], [0.4, -0.06], [2.0, -0.06], [2.4, 0]];
      return c;
    })(),
  };
  GESTURES.walkTalk = {
    dur: 2.8,
    locomote: 26,
    ch: Object.assign(walkCh(2.8, 26, 'walk'), {
      shL: osc(2.8, 24, 3, 0, 30), shR: osc(2.8, 24, 3, Math.PI, 30),
      elL: osc(2.8, 16, 3, 0, 60), elR: osc(2.8, 16, 3, Math.PI, 60),
      headTilt: osc(2.8, 0.05, 4, 0, 0.03),
    }),
  };
  GESTURES.walkThink = {
    dur: 2.8,
    locomote: 26,
    ch: Object.assign(walkCh(2.8, 26, 'walk'), {
      shR: [[0, 0], [0.4, 34], [2.4, 34], [2.8, 0]],
      elR: [[0, 8], [0.4, 122], [2.4, 122], [2.8, 8]],
      headTilt: [[0, 0], [0.4, 0.16], [2.4, 0.14], [2.8, 0]],
      handR: [[0, 'relaxed'], [0.4, 'fist'], [2.5, 'fist'], [2.8, 'relaxed']],
    }),
  };
  GESTURES.point = {
    dur: 1.6,
    ch: {
      shR: [[0, 0], [0.25, 86, 'backOut'], [1.2, 84], [1.6, 0]],
      elR: [[0, 8], [0.25, 6], [1.2, 6], [1.6, 8]],
      headTilt: [[0, 0], [0.3, 0.05], [1.3, 0.04], [1.6, 0]],
      handR: [[0, 'relaxed'], [0.2, 'point'], [1.4, 'point'], [1.6, 'relaxed']],
    },
  };
  GESTURES.jump = {
    dur: 1.2,
    ch: {
      y: [[0, 80], [0.22, 76.4, 'out'], [0.55, 80, 'in'], [1.2, 80]],
      kneeL: [[0, 0], [0.2, 55], [0.55, 12], [1.2, 0]],
      kneeR: [[0, 0], [0.2, 55], [0.55, 12], [1.2, 0]],
      shL: [[0, 0], [0.2, 120], [0.7, 30], [1.2, 0]],
      shR: [[0, 0], [0.2, 120], [0.7, 30], [1.2, 0]],
      elL: [[0, 8], [0.2, 25], [0.7, 40], [1.2, 8]],
      elR: [[0, 8], [0.2, 25], [0.7, 40], [1.2, 8]],
    },
  };


  GESTURES.slap = {
    dur: 0.9,
    ch: {
      shR: [[0, 0], [0.12, 96, 'out'], [0.26, 18, 'in'], [0.5, 26], [0.9, 0]],
      elR: [[0, 8], [0.12, 22], [0.26, 6], [0.9, 8]],
      headTilt: [[0, 0], [0.26, -0.16], [0.6, -0.1], [0.9, 0]],
      lean: [[0, 0], [0.2, 0.06], [0.9, 0]],
      handR: [[0, 'relaxed'], [0.1, 'open'], [0.7, 'open'], [0.9, 'relaxed']],
    },
  };
  GESTURES.kick = {
    dur: 1.0,
    ch: {
      hipR: [[0, 0], [0.25, 58, 'out'], [0.42, 6, 'in'], [0.7, 20], [1.0, 0]],
      kneeR: [[0, 0], [0.25, 18], [0.42, 4], [1.0, 0]],
      lean: [[0, 0], [0.25, -0.1], [0.7, -0.06], [1.0, 0]],
      shL: [[0, 0], [0.25, 32], [1.0, 0]],
      shR: [[0, 0], [0.25, 22], [1.0, 0]],
    },
  };
  GESTURES.hug = {
    dur: 2.0,
    ch: {
      shL: [[0, 0], [0.35, 84, 'backOut'], [1.6, 80], [2.0, 0]],
      shR: [[0, 0], [0.35, 84, 'backOut'], [1.6, 80], [2.0, 0]],
      elL: [[0, 8], [0.35, 96], [1.6, 96], [2.0, 8]],
      elR: [[0, 8], [0.35, 96], [1.6, 96], [2.0, 8]],
      lean: [[0, 0], [0.35, 0.09], [1.6, 0.08], [2.0, 0]],
      headTilt: [[0, 0], [0.35, 0.1], [1.6, 0.08], [2.0, 0]],
      handL: [[0, 'relaxed'], [0.3, 'open'], [1.7, 'open'], [2.0, 'relaxed']],
      handR: [[0, 'relaxed'], [0.3, 'open'], [1.7, 'open'], [2.0, 'relaxed']],
    },
  };
  GESTURES.kiss = {
    dur: 1.8,
    ch: {
      lean: [[0, 0], [0.35, 0.12, 'out'], [1.4, 0.1], [1.8, 0]],
      headTilt: [[0, 0], [0.35, 0.16], [1.4, 0.14], [1.8, 0]],
      smile: [[0, 0], [0.35, 0.9], [1.4, 0.85], [1.8, 0]],
      blush: [[0, 0], [0.35, 0.8], [1.4, 0.7], [1.8, 0]],
      shR: [[0, 0], [0.35, 30], [1.4, 26], [1.8, 0]],
      elR: [[0, 8], [0.35, 70], [1.4, 66], [1.8, 8]],
    },
  };

  const GESTURE_NAMES = Object.keys(GESTURES);

  /* ------------------------------------------------------------- idle life
     A small autonomous loop, so a companion standing around is never a statue.
     Each entry is added to the mood + gesture layers (an emotion still reads
     through), except `eye`, which multiplies eyeOpen so sleepy half-closes the
     lids. Values come from the repo's own clips: the chin-touch is thinkChin
     (shoulder 30 / elbow 138), the wave is the wave clip's raised arm. */

  const IDLE_TARGETS = {
    // calm: 0.17 on the neutral 0.08 smile = the gentle ~0.25 smile the idle
    // state is meant to wear (an emotion layer still overrides the baseline).
    calm:      { smile: 0.17, eye: 1,    headTilt: 0,     pupY: 0,     bend: 0,    lean: 0,    shR: 0,  elR: 0 },
    thinking:  { smile: 0.02, eye: 0.9,  headTilt: 0.2,   pupY: -0.5,  bend: 0.06, lean: 0.01, shR: 30, elR: 138 },
    strolling: { smile: 0.04, eye: 1,    headTilt: 0,     pupY: 0,     bend: 0,    lean: 0,    shR: 0,  elR: 0 },
    sleepy:    { smile: 0,    eye: 0.32, headTilt: 0.34,  pupY: 0.25,  bend: 0.1,  lean: 0,    shR: -3, elR: 4 },
    wake:      { smile: 0.3,  eye: 1,    headTilt: -0.06, pupY: -0.1,  bend: 0,    lean: 0,    shR: 118, elR: 34 },
  };
  const IDLE_TAU = 0.35;                 // seconds to blend between idle poses
  const IDLE_WALK_MIN = 8;               // a stroll is 8-14 stage unitsâ€¦
  const IDLE_WALK_MAX = 14;
  const IDLE_FACE_HOLD = 0.35;           // â€¦and he stays side-on this long after

  /* ------------------------------------------------------- channel store */

  function createChannels() {
    const vals = new Map();
    return {
      vals,
      setBase(name, v) { vals.set(name, v); },
      set(name, v) { vals.set(name, v); },
      get(name) { const v = vals.get(name); return typeof v === 'number' ? v : 0; },
      getDef(name, t, def) { const v = vals.get(name); return v === undefined || v === null ? def : v; },
    };
  }

  /* ------------------------------------------------------------------ rig */

  function createRig(opts) {
    opts = opts || {};
    const warnings = [];
    const fig = STICK.normalizeFigure(Object.assign({}, FIG_DEFAULTS, opts.figure || {}),
      0, m => warnings.push(m), 'sketch');
    const rt = { ch: createChannels(), figs: new Map([[fig.id, fig]]), loco: [], warnings };
    STICK.initFigureChannels(rt, fig);
    const id = fig.id + '.';
    const rest = {};
    [...FACE, ...POSTURE, ...ARMS, 'tilt', 'stanceW', 'x'].forEach(c => {
      rest[c] = num(rt.ch.getDef(id + c, 0, 0), 0);
    });

    const rig = {
      fig, rt, warnings,
      emotion: 'neutral',
      intensity: 1,
      targetIntensity: 1,
      emoTau: 0.25,
      v: Object.assign({}, rest),
      life: { energy: 0.4, sway: 0.4, bounce: 0 },
      gestures: [],
      speech: { active: false, t0: 0, until: 0, level: 0, text: '', seed: 1 },
      singing: false,
      audioLevel: 0,     // 0..1, set from real audio when a TTS stream plays
      useAudioLevel: false,
      gaze: { x: 0, y: 0, tx: 0, ty: 0, mode: 'auto', next: 0, gen: 0 },
      pupil: { x: 0, y: 0 },
      pupilT: { x: 0, y: 0 },
      blinkUntil: -Infinity,
      emotes: [],
      lastEmoteAt: -10,
      nextSleepEmote: 0,
      pose: null,
      t: 0,
      // ---- autonomous idle life (see updateIdle below)
      idleState: 'calm',
      idleLayer: Object.assign({}, IDLE_TARGETS.calm),
      walkFace: 0,          // travel direction of the current walk (+1 right)
      walkFaceUntil: 0,     // hold the side profile this long, then face front
      idle: {
        state: 'calm',
        since: 0,           // when the current state began
        until: 0,           // when a timed state (thinking/sleepy/wake/stroll) ends
        next: 0,            // when the current calm spell ends and we pick a beat
        quiet: 0,            // t of the last real interaction
        sleepAfter: 0,      // quiet seconds before he dozes off (45-60)
        rnd: makeRng(fig.seed * 1013 + 0.37),
      },
    };
    rig.idle.next = 6 + rig.idle.rnd() * 4;          // 6-10s of calm, then a beat
    rig.idle.sleepAfter = 45 + rig.idle.rnd() * 15;

    /* ---- per-frame update: smooth targets, add layers, sample the skeleton */
    rig.step = function (dt, t) {
      dt = clamp(dt, 0.0005, 0.06);
      this.t = t;
      // Anchor the figure where it was placed; gesture x tracks are offsets
      // from this, so walking can travel without losing the staging position.
      if (this.baseX == null) {
        this.baseX = (this.fig.pos && typeof this.fig.pos.x === 'number') ? this.fig.pos.x : 50;
      }

      const kEmo = 1 - Math.exp(-dt / this.emoTau);
      const kPost = 1 - Math.exp(-dt / (this.emoTau * 1.5));

      this.intensity += (this.targetIntensity - this.intensity) * kEmo;
      const I = this.intensity;
      const emo = EMOTIONS[this.emotion] || NEUTRAL;
      // intensity = deviation from neutral, exactly like the `mood` command
      const sv = (v, b) => b + (v - b) * I;

      FACE.forEach(c => {
        const tgt = sv(num(emo.expr[c], NEUTRAL.expr[c] || 0), num(NEUTRAL.expr[c], 0));
        this.v[c] += (tgt - this.v[c]) * kEmo;
      });
      POSTURE.forEach(c => {
        const tgt = sv(num(emo.pose[c], 0), 0);
        this.v[c] += (tgt - this.v[c]) * kPost;
      });

      const lifeT = {
        energy: sv(num(emo.life.energy, 0.4), 0.4),
        sway: sv(num(emo.life.sway, 0.4), 0.4),
        bounce: sv(num(emo.life.bounce, 0), 0),
      };
      for (const k in lifeT) this.life[k] += (lifeT[k] - this.life[k]) * kPost;
      const energy = this.life.energy, sway = this.life.sway, bounce = this.life.bounce;

      // ---- idle layer: breathing, weight shift, shoulder drift, joy bounce
      const breathRate = 0.20 + 0.10 * energy;
      const idleBend = 0.026 * energy * Math.sin(2 * Math.PI * breathRate * t + 0.6);
      const idleHead = 0.012 * energy * Math.sin(2 * Math.PI * breathRate * t + 1.15);
      const idleLean = 0.007 * sway * Math.sin(2 * Math.PI * 0.115 * t);
      const idleShL = 1.6 * sway * Math.sin(2 * Math.PI * 0.15 * t + 0.5);
      const idleShR = 1.6 * sway * Math.sin(2 * Math.PI * 0.15 * t + 2.3);
      const idleStance = 0.12 * sway * Math.sin(2 * Math.PI * 0.07 * t);
      const bounceY = bounce * 0.9 * Math.max(0, Math.sin(2 * Math.PI * 1.7 * t)) ** 2;

      const val = {
        smile: this.v.smile,
        eyeOpen: this.v.eyeOpen,
        browTilt: this.v.browTilt,
        browRaise: this.v.browRaise,
        browSkew: this.v.browSkew,
        tears: this.v.tears,
        blush: this.v.blush,
        mouthOpen: this.v.mouthOpen,
        bend: this.v.bend + idleBend,
        lean: this.v.lean + idleLean,
        headTilt: this.v.headTilt + idleHead,
        stanceW: idleStance,
        tilt: 0,
        facing: 0,          // set by a walk's tracks; 0 = front-on
        shL: rest.shL + idleShL,
        shR: rest.shR + idleShR,
        elL: rest.elL,
        elR: rest.elR,
        hipL: 0, hipR: 0, kneeL: 0, kneeR: 0,
        handL: 'relaxed',
        handR: 'relaxed',
        y: 0,
      };
      if (this.emotion === 'angry' && this.intensity > 0.65) {
        val.handL = 'fist';
        val.handR = 'fist';
      }

      // ---- gesture layer: additive, weighted cross-fades
      let mouthAdd = 0;
      const alive = [];
      for (const g of this.gestures) {
        const def = g.custom || GESTURES[g.name];
        if (!def) continue;
        const lt = t - g.start;
        if (lt > def.dur + 0.3) {
          // Locomotion leaves the figure where it walked to. Without banking
          // the displacement, every walk snapped back to its starting spot.
          if (def.locomote) this.baseX = clamp(this.baseX + def.locomote, 8, 92);
          continue;
        }
        alive.push(g);
        const w = Math.min(clamp(lt / 0.14, 0, 1), clamp((def.dur + 0.28 - lt) / 0.28, 0, 1));
        // A walk still owns its travel offset at w = 0 (see the x hold below).
        if (w <= 0 && !def.locomote) continue;
        for (const chName in def.ch) {
          const v = sampleTrack(def.ch[chName], clamp(lt, 0, def.dur));
          if (typeof v === 'string') { if (w > 0.45) val[chName] = v; continue; }
          if (FACE_BLEND.has(chName)) {
            // expressions blend toward the clip's face rather than adding to it
            val[chName] = (val[chName] == null ? v : val[chName]) * (1 - w) + v * w;
            continue;
          }
          // x tracks are offsets from the staging position, so their baseline is
          // 0 â€” not rest.x, which is the figure's absolute stage x.
          const base = chName === 'y' ? BASE_Y : chName === 'x' ? 0 : (rest[chName] != null ? rest[chName] : 0);
          // A walk must not slide back to where it started while it fades out:
          // hold its travel offset until the displacement is banked into baseX.
          const cw = chName === 'x' && def.locomote ? 1 : w;
          val[chName] = (val[chName] == null ? base : val[chName]) + (v - base) * cw;
        }
        if (def.mouth) mouthAdd += sampleTrack(def.mouth, clamp(lt, 0, def.dur)) * w;
      }
      this.gestures = alive;

      // ---- talk layer: hands and head move while the character speaks
      const sp = this.speech;
      const singing = this.singing;
      if (sp.active) {
        if (t > sp.until) sp.active = false;
      }
      const talking = sp.active || singing;
      if (talking) {
        let tgt;
        if (this.useAudioLevel) tgt = this.audioLevel;
        else if (singing) tgt = 0.42 + 0.3 * Math.sin(2 * Math.PI * 1.55 * t) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 0.21 * t));
        else tgt = speechLevel(t, sp.seed);
        const tau = tgt > sp.level ? 0.045 : 0.1;      // fast attack, relaxed release
        sp.level += (tgt - sp.level) * (1 - Math.exp(-dt / tau));
      } else {
        sp.level += (0 - sp.level) * (1 - Math.exp(-dt / 0.12));
      }

      if (talking && !singing) {
        // conversational beats: alternate hands, small shoulder/elbow swings
        const wR = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.33 * t);
        const wL = 1 - wR;
        const amp = Math.min(1, sp.level * 1.4);
        val.shR += amp * (8 + 9 * wR) + amp * 3 * Math.sin(2 * Math.PI * 1.1 * t + 0.4);
        val.elR += amp * (26 + 22 * wR) + amp * 8 * Math.sin(2 * Math.PI * 1.35 * t + 1.1);
        val.shL += amp * (5 + 7 * wL) + amp * 3 * Math.sin(2 * Math.PI * 0.95 * t + 2.1);
        val.elL += amp * (18 + 18 * wL) + amp * 7 * Math.sin(2 * Math.PI * 1.2 * t + 0.7);
        val.headTilt += amp * 0.05 * Math.sin(2 * Math.PI * 2.0 * t + 0.9);
        val.browRaise += 0.05 * amp;
      } else if (singing) {
        val.lean += 0.012 * Math.sin(2 * Math.PI * 0.6 * t);
        val.headTilt += 0.05 * Math.sin(2 * Math.PI * 0.6 * t + 1.2);
        val.shL += 12 + 4 * Math.sin(2 * Math.PI * 0.8 * t);
        val.elL += 34 + 8 * Math.sin(2 * Math.PI * 1.1 * t);
        val.browRaise += 0.12;
      }

      let mouth = clamp(Math.max(val.mouthOpen, sp.level) + mouthAdd, 0, 1);
      if (singing) mouth = clamp(Math.max(mouth, sp.level), 0, 1);
      mouth = clamp(mouth * 1.12, 0, 1);   // a touch more open, so it reads at stage size

      // ---- autonomous idle layer: calm / thinking / strolling / sleepy / wake.
      // Runs after gestures and speech so it can see them and stand down.
      this.updateIdle(t, dt);
      const il = this.idleLayer;
      val.smile += il.smile;
      val.eyeOpen *= il.eye;
      val.headTilt += il.headTilt;
      val.bend += il.bend;
      val.lean += il.lean;
      val.shR += il.shR;
      val.elR += il.elR;
      if (this.idle.state === 'thinking') val.handR = 'fist';
      if (this.idle.state === 'wake') {
        // the hello wave: the idle layer lifts the arm, this swings the forearm
        const wu = t - this.idle.since;
        val.elR += 22 * Math.sin(2 * Math.PI * 3 * wu) * clamp(wu / 0.15, 0, 1);
      }

      // ---- gaze layer: saccades when idle, hold when told to look
      const gz = this.gaze;
      if (gz.mode === 'auto' && t > gz.next) {
        gz.gen++;
        gz.tx = (hash01(gz.gen * 1.7) - 0.5) * 0.55;
        gz.ty = (hash01(gz.gen * 2.3) - 0.5) * 0.4 - 0.08;
        gz.next = t + 1.2 + hash01(gz.gen * 3.1) * 2.4;
      }
      const gk = 1 - Math.exp(-dt / (gz.mode === 'auto' ? 0.075 : 0.13));
      gz.x += (gz.tx - gz.x) * gk;
      gz.y += (gz.ty - gz.y) * gk;

      // mood presets also bias the pupils (thinking looks up, embarrassed down)
      const pk = 1 - Math.exp(-dt / 0.35);
      this.pupil.x += (this.pupilT.x - this.pupil.x) * pk;
      this.pupil.y += (this.pupilT.y - this.pupil.y) * pk;

      const blink = t < this.blinkUntil ? 0.06 : 1;

      // ---- emotes: pop a symbol next to the head, then let it fade
      if (this.emotes.length) this.emotes = this.emotes.filter(e => t < e.t1);
      if (this.emotion === 'sleepy' && t > this.nextSleepEmote) {
        this.emote('zzz', 2400);
        this.nextSleepEmote = t + 3.2;
      }

      // ---- write channels, then let the stock skeleton solve the pose
      const ch = this.rt.ch;
      ch.set(id + 'smile', clamp(val.smile, -1, 1));
      ch.set(id + 'eyeOpen', clamp(val.eyeOpen, 0, 1) * blink);
      ch.set(id + 'browTilt', clamp(val.browTilt, -1, 1));
      ch.set(id + 'browRaise', clamp(val.browRaise, -0.3, 1));
      ch.set(id + 'browSkew', clamp(val.browSkew, -1, 1));
      ch.set(id + 'tears', clamp(val.tears, 0, 1));
      ch.set(id + 'blush', clamp(val.blush, 0, 1));
      ch.set(id + 'mouthOpen', mouth);
      ch.set(id + 'bend', val.bend);
      ch.set(id + 'lean', val.lean);
      ch.set(id + 'headTilt', clamp(val.headTilt, -0.6, 0.7));
      ch.set(id + 'tilt', clamp(val.tilt, -35, 35));
      ch.set(id + 'stanceW', clamp(val.stanceW, -1.5, 2.5));
      ch.set(id + 'shL', clamp(val.shL, -90, 190));
      ch.set(id + 'shR', clamp(val.shR, -90, 190));
      ch.set(id + 'elL', clamp(val.elL, 0, 165));
      ch.set(id + 'elR', clamp(val.elR, 0, 165));
      ch.set(id + 'hipL', clamp(val.hipL, -80, 95));
      ch.set(id + 'hipR', clamp(val.hipR, -80, 95));
      ch.set(id + 'kneeL', clamp(val.kneeL, 0, 160));
      ch.set(id + 'kneeR', clamp(val.kneeR, 0, 160));
      ch.set(id + 'handL', val.handL);
      ch.set(id + 'handR', val.handR);
      ch.set(id + 'pupX', clamp(gz.x + this.pupil.x, -1, 1));
      // the idle loop can bias the gaze (thinking looks up, sleepy looks down)
      ch.set(id + 'pupY', clamp(gz.y + this.pupil.y + il.pupY, -1, 1));
      ch.set(id + 'y', BASE_Y + val.y - bounceY);
      // horizontal position: walking/running actually travel across the stage.
      // Without this the bones animate but the figure never leaves its spot.
      ch.set(id + 'x', clamp(this.baseX + (val.x || 0), 6, 94));
      // facing: -1 turns left, 1 turns right, 0 faces the viewer (front-on).
      // faceFor()/faceTowards() hold a direction while active. Otherwise a walk
      // sets the body to its direction of travel, so the walk is drawn in side
      // profile (the engine mirrors the body group with scale(facing, 1)); that
      // direction holds for a moment after the walk, then relaxes to 0.
      let facing = 0;
      if (this.faceTarget != null && t < (this.faceUntil || 0)) {
        facing = this.faceTarget;
      } else if (val.facing) {
        facing = val.facing > 0 ? 1 : -1;
        this.walkFace = facing;
        this.walkFaceUntil = t + IDLE_FACE_HOLD;
      } else if (t < (this.walkFaceUntil || 0)) {
        facing = this.walkFace;
      } else {
        this.walkFace = 0;
        this.faceTarget = null;        // the hold is over: back to the viewer
      }
      ch.set(id + 'facing', clamp(facing, -1, 1));

      this.pose = STICK.computeFigure(this.rt, this.fig, t);
      return this.pose;
    };

    /* -------------------------------------------------------- idle life ----
       calm â†’ (thinking | strolling | calm), and a long quiet spell makes him
       sleepy â†’ wake â†’ calm. Every entry point below is also an exit: any real
       interaction calls resetIdle() and puts him back in calm. */

    // Enter an idle state; `until` is the absolute time a timed state ends.
    rig.setIdle = function (state, until) {
      const idle = this.idle;
      idle.state = state;
      idle.since = this.t;
      idle.until = until || 0;
      this.idleState = state;
      if (state === 'calm') idle.next = this.t + 6 + idle.rnd() * 4;
      return state;
    };

    // A real interaction happened: forget the idle plan and be calm (and awake).
    rig.resetIdle = function () {
      const idle = this.idle;
      idle.quiet = this.t;
      idle.sleepAfter = 45 + idle.rnd() * 15;
      return this.setIdle('calm');
    };

    // Walk a short distance left or right, then settle back into calm.
    function startStroll(t, rnd) {
      const dist = IDLE_WALK_MIN + rnd() * (IDLE_WALK_MAX - IDLE_WALK_MIN);
      const base = rig.baseX == null ? 50 : rig.baseX;
      let dir = rnd() < 0.5 ? -1 : 1;
      if (base + dir * dist > 90 || base + dir * dist < 10) dir = -dir;  // walk into open stage
      // A stroll is unhurried (14 u/s), and idle:false so it does not reset the
      // very loop that started it.
      const res = rig.goTo(base + dir * dist, { gap: 18, speed: 14, idle: false });
      if (!res.walked) { rig.setIdle('calm'); return; }
      rig.setIdle('strolling', t + res.dur + IDLE_FACE_HOLD);
    }

    // Decide what he does next. Called after the gesture and speech layers, so
    // `this.gestures` is already pruned to the clips that are still alive.
    rig.idleStep = function (t) {
      const idle = this.idle, rnd = idle.rnd;

      // Our own stroll is locomotion too: let it travel before anything else.
      if (idle.state === 'strolling') {
        if (t < idle.until) return;
        this.setIdle('calm');
        return;
      }

      // Never compete with speech or with a gesture (walking clips included).
      const busy = this.speech.active || this.singing || this.gestures.length > 0;
      if (busy) {
        if (idle.state !== 'calm') this.setIdle('calm');
        idle.quiet = t;                        // company counts as interaction
        idle.next = Math.max(idle.next, t + 2.5);
        return;
      }

      // A long quiet spell makes him drowsy, wherever he is in the loop.
      if (idle.state === 'calm' && t - idle.quiet >= idle.sleepAfter) {
        this.setIdle('sleepy', t + 8 + rnd() * 4);
        this.emote('zzz', 2600);
        return;
      }

      if (idle.state === 'thinking') {
        if (t < idle.until) return;
        this.setIdle('calm');
        return;
      }
      if (idle.state === 'sleepy') {
        if (t < idle.until) return;
        // pop awake: eyes open, a grin and a small hello wave, then calm
        this.setIdle('wake', t + 1.5);
        idle.quiet = t;
        idle.sleepAfter = 45 + rnd() * 15;
        this.emote('sparkle', 1200);
        return;
      }
      if (idle.state === 'wake') {
        if (t < idle.until) return;
        this.setIdle('calm');
        return;
      }

      // calm: after 6-10s, pick the next beat (35% / 35% / 30%).
      if (t < idle.next) return;
      const r = rnd();
      if (r < 0.35) this.setIdle('thinking', t + 2.5 + rnd() * 1.5);
      else if (r < 0.70) startStroll(t, rnd);
      else idle.next = t + 6 + rnd() * 4;      // stay calm a little longer
    };

    // Blend the idle pose toward the current state's target. step() applies it.
    rig.updateIdle = function (t, dt) {
      this.idleStep(t);
      const tgt = IDLE_TARGETS[this.idle.state] || IDLE_TARGETS.calm;
      const k = 1 - Math.exp(-dt / IDLE_TAU);
      const L = this.idleLayer;
      for (const key in tgt) L[key] += (tgt[key] - L[key]) * k;
    };

    /* ------------------------------------------------------------- actions */

    rig.value = function (name) {
      return this.rt.ch.getDef(this.fig.id + '.' + name, this.t, 0);
    };

    rig.setEmotion = function (name, o) {
      o = o || {};
      if (!EMOTIONS[name]) return { ok: false, error: 'unknown emotion "' + name + '"' };
      this.resetIdle();                    // a mood change is an interaction
      const changed = this.emotion !== name;
      this.emotion = name;
      const preset = EMOTIONS[name];
      this.pupilT = { x: num(preset.expr.pupilX, 0), y: num(preset.expr.pupilY, 0) };
      this.targetIntensity = clamp(num(o.intensity, 1), 0, 1.6);
      const ms = num(o.duration, 500);
      this.emoTau = clamp(ms / 1000 / 2.2, 0.06, 0.8);
      if (changed && EMOTION_EMOTE[name] && this.t - this.lastEmoteAt > 1.2) this.emote(EMOTION_EMOTE[name]);
      if (changed && EMOTION_GESTURE[name]) this.gesture(EMOTION_GESTURE[name]);
      // Auto gestures: emotions breathe life into the body even when the
      // caller only sent a mood (never while another gesture is running).
      if (changed && this.autoGestures !== false && !this.gestures.length
          && this.t - (this.lastAutoGesture || -9) > 2.5 && AUTO_GESTURE[name]) {
        this.gesture(AUTO_GESTURE[name]);
        this.lastAutoGesture = this.t;
      }
      return { ok: true };
    };

    // Choose a walking distance for this moment: away from the nearest edge,
    // never off the stage, and alternating when in the middle. A fixed +26 in
    // the gesture table made every walk go right forever.
    rig._walkDistance = function (want) {
      const x = this.baseX == null ? 50 : this.baseX;
      const LEFT = 12, RIGHT = 88, KEEP = 10;
      let dir;
      if (x > 60) dir = -1;
      else if (x < 40) dir = 1;
      else dir = (this._lastWalkDir === 1 ? -1 : 1);
      this._lastWalkDir = dir;
      const room = dir > 0 ? (RIGHT - x) : (x - LEFT);
      const dist = Math.max(KEEP, Math.min(Math.abs(want || 26), room));
      return dir * dist;
    };

    rig.gesture = function (name) {
      if (!GESTURES[name]) return { ok: false, error: 'unknown gesture "' + name + '"' };
      this.resetIdle();
      this.gestures = this.gestures.filter(g => g.name !== name);
      const def = GESTURES[name];
      if (def && def.locomote) {
        // rebuild the x track for the chosen direction, keeping every other
        // channel (arm swing, talk pose, thinking hand) from the table
        const dist = this._walkDistance(def.locomote);
        const kind = name === 'run' ? 'run' : 'walk';
        const sign = dist < 0 ? -1 : 1;
        const ch = Object.assign({}, def.ch, { x: [[0, 0], [def.dur, dist]] });
        if (ch.facing) ch.facing = [[0, sign], [def.dur, sign]];
        this.gestures.push({ name, start: this.t, custom: { dur: def.dur, ch, locomote: dist } });
        return { ok: true };
      }
      this.gestures.push({ name, start: this.t });
      return { ok: true };
    };

    // Turn to face a point on the stage (used when pointing at a board).
    rig.faceTowards = function (worldX) {
      const head = this.pose ? this.pose.world.head.x : this.baseX;
      const dir = worldX < head ? -1 : 1;
      this.resetIdle();
      this.faceTarget = dir;
      this.faceUntil = this.t + 6;
      return dir;
    };

    // Turn toward someone for a moment while speaking, then return to front.
    rig.faceFor = function (dir, ms) {
      this.resetIdle();
      this.faceTarget = dir;
      this.faceUntil = this.t + (ms || 2000) / 1000;
      this.faceRest = 0;                 // back to the viewer afterwards
      return dir;
    };

    // Place the figure at a stage x, walking there if it is far away. Used by
    // drag-and-drop and by the director when it stages a scene.
    rig.goTo = function (targetX, opts) {
      opts = opts || {};
      if (opts.idle !== false) this.resetIdle();   // being staged is an interaction
      let tx = clamp(num(targetX, this.baseX), 8, 92);
      // Keep a gap from the other performers so nobody stands inside anyone.
      const gap = opts.gap == null ? 22 : opts.gap;
      for (const other of (opts.avoid || [])) {
        if (Math.abs(tx - other) < gap) {
          tx = other + (tx >= other ? gap : -gap);
        }
      }
      tx = clamp(tx, 8, 92);
      const from = this.baseX;
      const dist = tx - from;
      if (Math.abs(dist) < 1.2) {
        this.baseX = tx;
        return { ok: true, walked: false };
      }
      // scale the gait duration to the distance so it never moon-walks
      const speed = opts.speed || 26;      // stage units per second
      const dur = clamp(Math.abs(dist) / speed, 0.5, 4.5);
      const kind = opts.run ? 'run' : 'walk';
      const d = Math.sign(dist) * Math.abs(dist);
      // Side profile while travelling: the engine mirrors the body group with
      // scale(facing, 1), so writing the direction of travel is the whole turn.
      // Hold it a moment past the walk, then step() relaxes back to front.
      this.walkFace = dist > 0 ? 1 : -1;
      this.walkFaceUntil = this.t + dur + IDLE_FACE_HOLD;
      this.gestures = this.gestures.filter(g => g.name !== '_move');
      this.gestures.push({
        name: '_move',
        start: this.t,
        custom: { dur, ch: walkCh(dur, d, kind), locomote: d },
      });
      return { ok: true, walked: true, dur };
    };

    rig.emote = function (symbol, ms) {
      const raw = String(symbol == null ? 'idea' : symbol);
      const s = EMOTE_GLYPH[raw.toLowerCase()] || raw;
      // Retire whatever is on screen with a quick fade instead of stacking a
      // second symbol at the same anchor (that was the visible flicker).
      for (const e of this.emotes) e.t1 = Math.min(e.t1, this.t + 0.12);
      this.emoteSeq = (this.emoteSeq || 0) + 1;
      this.emotes.push({
        id: this.emoteSeq, symbol: s,
        t0: this.t + 0.03, t1: this.t + (num(ms, 1700) / 1000),
      });
      if (this.emotes.length > 4) this.emotes = this.emotes.slice(-4);
      this.lastEmoteAt = this.t;
      return { ok: true };
    };

    rig.startSpeech = function (text, o) {
      o = o || {};
      this.resetIdle();
      const s = String(text == null ? '' : text);
      const dur = num(o.duration, clamp(1.1 + s.length * 0.055, 1.2, 16));
      this.singing = false;
      this.useAudioLevel = false;          // synthetic jaw unless real audio drives it
      this.speech = {
        active: true, t0: this.t, until: this.t + dur,
        level: this.speech ? this.speech.level : 0, text: s, seed: hash01(this.t + 3.7) * 100,
      };
      return { ok: true, duration: dur };
    };

    rig.stopSpeech = function () {
      this.speech.active = false;
      this.speech.until = this.t;
      this.singing = false;
      this.useAudioLevel = false;
      return { ok: true };
    };

    rig.setSinging = function (on) {
      this.singing = !!on;
      if (this.singing) {
        this.useAudioLevel = false;
        this.speech.active = true;
        this.speech.until = Infinity;
        this.emote('music', 2200);
      } else {
        this.speech.active = false;
        this.speech.until = this.t;
      }
      return { ok: true };
    };

    rig.setAudioLevel = function (v) {
      this.audioLevel = clamp(num(v, 0), 0, 1);
      this.useAudioLevel = true;
      return { ok: true };
    };

    rig.lookAt = function (x, y, mode) {
      const gz = this.gaze;
      gz.mode = mode || 'point';
      gz.tx = clamp(num(x, 0), -1, 1);
      gz.ty = clamp(num(y, 0), -1, 1);
      return { ok: true };
    };

    rig.blink = function () {
      this.blinkUntil = this.t + 0.12;
      return { ok: true };
    };

    // Touch reactions: tapping a body part plays a fitting reaction.
    rig.react = function (part) {
      this.resetIdle();
      const p = String(part || 'head');
      if (p === 'head' || p === 'face') {
        this.setEmotion('embarrassed', { intensity: 1, duration: 220 });
        this.gesture('shy');
        this.emote('sparkle', 1500);
        this.lookAt(-0.55, 0.5, 'point');
      } else if (p === 'armL' || p === 'armR') {
        this.setEmotion('happy', { intensity: 0.9, duration: 200 });
        this.gesture('wave');
        this.emote('heart', 1500);
      } else if (p === 'torso') {
        this.setEmotion('laughing', { intensity: 1, duration: 200 });
        this.gesture('beat');
        this.emote('sparkle', 1400);
      } else if (p === 'legL' || p === 'legR') {
        this.setEmotion('surprised', { intensity: 0.9, duration: 160 });
        this.gesture('hopJoy');
      } else {
        this.setEmotion('surprised', { intensity: 0.8, duration: 160 });
        this.gesture('nod');
      }
      return { ok: true, part: p };
    };

    rig.reset = function () {
      this.emotion = 'neutral';
      this.targetIntensity = 1;
      this.intensity = 1;
      this.gestures = [];
      this.emotes = [];
      this.stopSpeech();
      this.gaze.mode = 'auto';
      this.gaze.tx = this.gaze.ty = 0;
      this.resetIdle();
      return { ok: true };
    };

    /* ------------------------- event adapter (Phase 4) ---------------------- */

    rig.apply = function (ev) {
      if (!ev || typeof ev !== 'object') return { ok: false, error: 'event must be an object' };
      this.resetIdle();
      let r;
      switch (ev.type) {
        case 'emotion': r = this.setEmotion(ev.value, ev); break;
        case 'gesture': r = this.gesture(ev.value); break;
        case 'emote': r = this.emote(ev.value, ev.duration); break;
        case 'sing': r = this.setSinging(ev.value === true || ev.value === 'on' || ev.value === 'start'); break;
        case 'speech':
          if (ev.value === 'speaking') {
            this.useAudioLevel = false;
            this.speech.active = true;
            this.speech.until = Infinity;
            this.speech.t0 = this.t;
            this.speech.seed = hash01(this.t + 3.7) * 100;
            r = { ok: true };
          } else if (ev.value === 'stopped') {
            r = this.stopSpeech();
          } else {
            r = { ok: false, error: 'speech value must be "speaking" or "stopped"' };
          }
          break;
        case 'speak':
        case 'say':
          r = this.startSpeech(ev.text, ev);
          if (r.ok && ev.emotion) this.setEmotion(ev.emotion, ev);
          if (r.ok && ev.gesture) this.gesture(ev.gesture);
          if (r.ok && ev.intensity != null) this.targetIntensity = clamp(num(ev.intensity, 1), 0, 1.6);
          break;
        case 'gaze':
          r = ev.value === 'auto' ? this.lookAt(0, 0, 'auto') : this.lookAt(ev.x, ev.y, 'point');
          break;
        case 'blink': r = this.blink(); break;
        case 'reset': r = this.reset(); break;
        default: r = { ok: false, error: 'unknown event type "' + ev.type + '"' };
      }
      if (!r.ok && this.warnings.length < 100) this.warnings.push(r.error);
      return r;
    };

    rig.state = function () {
      return {
        emotion: this.emotion,
        intensity: +this.intensity.toFixed(2),
        speaking: this.speech.active,
        singing: this.singing,
        gestures: this.gestures.map(g => g.name),
        gaze: this.gaze.mode,
        idle: this.idleState,
        mouthOpen: +this.value('mouthOpen').toFixed(2),
        smile: +this.value('smile').toFixed(2),
      };
    };

    return rig;
  }

  /* -------------------------------------------------------------- mounting */

  // Top group for the character; draws emotes above it and animates a zoom.
  function mount(svg, rig, opts) {
    opts = opts || {};
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs, parent) => {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(el);
      return el;
    };
    let root = null, layer = null, nodes = null, style = null, emoteLayer = null;
    let wearLayer = null, faceLayer = null;
    const emoteNodes = new Map();      // id -> { g, txt, anchorX, anchorY, dying }
    const view = { style: opts.style || rig.fig.style || 'sketch', zoom: 'full' };
    const manageBox = opts.manageViewBox !== false;

    /* ---------------------------------------------------- accessories
       Drawn on their own layers, positioned from live head/shoulder
       geometry each frame, so they sit ON the figure without covering the
       eyes or mouth. */
    const look = { wear: 'none', face: 'none' };

    function buildAccessories() {
      if (wearLayer) wearLayer.remove();
      if (faceLayer) faceLayer.remove();
      wearLayer = mk('g', { class: 'wear-layer' }, root);
      faceLayer = mk('g', { class: 'face-layer' }, root);
    }

    function paintAccessories() {
      if (!wearLayer || !rig.pose) return;
      const P = rig.pose;
      const h = P.world.head;
      const r = P.g.headR;
      const [wm, fm] = [look.wear, look.face];
      wearLayer.innerHTML = '';
      faceLayer.innerHTML = '';

      if (wm === 'crown') {
        // sits above the skull, following head tilt
        const tilt = (P.ch && P.ch.get && P.ch.get(rig.fig.id + 'headTilt')) || 0;
        const cx = h.x + Math.sin(tilt) * r * 0.9;
        const cy = h.y - r * 1.02;
        const g = mk('g', { transform: `translate(${cx} ${cy}) rotate(${(tilt * 57.3).toFixed(1)})` }, wearLayer);
        const w = r * 1.15, hh = r * 0.62;
        mk('path', {
          d: `M ${-w} 0 L ${-w} ${-hh * 0.45} L ${-w * 0.5} ${-hh * 0.05} L 0 ${-hh} L ${w * 0.5} ${-hh * 0.05} L ${w} ${-hh * 0.45} L ${w} 0 Z`,
          fill: '#e8b84b', stroke: '#a67c1e', 'stroke-width': 0.18, 'stroke-linejoin': 'round',
        }, g);
        mk('circle', { cx: 0, cy: -hh * 0.72, r: r * 0.09, fill: '#c0392b' }, g);
      } else if (wm === 'cape') {
        // a cape behind the torso: two swept panels from the shoulders
        const sh = P.world.neck || { x: h.x, y: h.y + r * 1.3 };
        const g = mk('g', { class: 'cape' }, wearLayer);
        const top = sh.y + r * 0.15, len = r * 5.2, halfW = r * 1.5;
        mk('path', {
          d: `M ${sh.x - halfW * 0.55} ${top} C ${sh.x - halfW} ${top + len * 0.45} ${sh.x - halfW * 1.15} ${top + len * 0.8} ${sh.x - halfW * 0.8} ${top + len}
              L ${sh.x + halfW * 0.8} ${top + len} C ${sh.x + halfW * 1.15} ${top + len * 0.8} ${sh.x + halfW} ${top + len * 0.45} ${sh.x + halfW * 0.55} ${top} Z`,
          fill: '#b8472f', opacity: 0.92, stroke: '#8d3323', 'stroke-width': 0.18,
        }, g);
      } else if (wm === 'dress') {
        const sh = P.world.neck || { x: h.x, y: h.y + r * 1.3 };
        const g = mk('g', {}, wearLayer);
        const top = sh.y + r * 0.2, len = r * 4.4;
        mk('path', {
          d: `M ${sh.x - r * 0.62} ${top} L ${sh.x + r * 0.62} ${top}
              L ${sh.x + r * 1.85} ${top + len} L ${sh.x - r * 1.85} ${top + len} Z`,
          fill: '#6d5bd0', opacity: 0.92, stroke: '#4c3ea3', 'stroke-width': 0.18,
        }, g);
      } else if (wm === 'mic') {
        // A handheld mic in the near hand: capsule + tapered body + cable.
        // Positioned from the live hand joint so it follows every gesture.
        const hand = P.world.handR || P.world.handL || { x: h.x + r * 1.6, y: h.y + r * 2.4 };
        const g = mk('g', { class: 'mic-prop' }, wearLayer);
        // body
        mk('path', {
          d: `M ${hand.x + 0.4} ${hand.y + 0.2} l 0.9 2.6 l -0.9 0.5 l -0.9 -0.5 z`,
          fill: '#2b2b2b',
        }, g);
        // capsule
        mk('circle', { cx: hand.x + 0.85, cy: hand.y + 0.05, r: 0.95, fill: '#4a4a4a', stroke: '#1b1b1b', 'stroke-width': 0.12 }, g);
        mk('circle', { cx: hand.x + 0.85, cy: hand.y + 0.05, r: 0.55, fill: '#8f8f8f', opacity: 0.75 }, g);
        // cable curving away
        mk('path', {
          d: `M ${hand.x + 0.4} ${hand.y + 3.3} q 1.6 2.2 0.2 4.6`,
          fill: 'none', stroke: '#1b1b1b', 'stroke-width': 0.16, opacity: 0.8,
        }, g);
      }

      const eyeY = h.y - r * 0.06;
      if (fm === 'mustache') {
        // below the nose line, clear of the mouth
        const y = h.y + r * 0.30;
        mk('path', {
          d: `M ${h.x} ${y} q ${-r * 0.42} ${-r * 0.18} ${-r * 0.62} ${r * 0.12}
              q ${r * 0.3} ${r * 0.1} ${r * 0.62} ${-r * 0.06}
              q ${r * 0.32} ${r * 0.16} ${r * 0.62} ${r * 0.06}
              q ${-r * 0.2} ${-r * 0.3} ${-r * 0.62} ${-r * 0.12} Z`,
          fill: '#2b2b2b',
        }, faceLayer);
      } else if (fm === 'glasses') {
        const rx = r * 0.28, ry = r * 0.22, dx = r * 0.42;
        for (const s of [-1, 1]) {
          mk('circle', {
            cx: h.x + s * dx, cy: eyeY, r: rx,
            fill: 'rgba(210,230,255,.18)', stroke: '#2b2b2b', 'stroke-width': 0.16,
          }, faceLayer);
        }
        mk('line', {
          x1: h.x - dx + rx, y1: eyeY, x2: h.x + dx - rx, y2: eyeY,
          stroke: '#2b2b2b', 'stroke-width': 0.14,
        }, faceLayer);
      } else if (fm === 'ears') {
        for (const s of [-1, 1]) {
          mk('ellipse', {
            cx: h.x + s * r * 0.99, cy: h.y + r * 0.04,
            rx: r * 0.13, ry: r * 0.2,
            fill: 'none', stroke: '#2b2b2b', 'stroke-width': 0.16,
          }, faceLayer);
        }
      }
    }

    const FULL = (opts.fullBox || [18, 24, 64, 64]).slice();
    const FACE = (opts.faceBox || [36.5, 27.5, 27, 27]).slice();
    const box = FULL.slice();
    let target = FULL.slice();

    function build() {
      if (root) root.remove();
      root = mk('g', { class: 'character', 'data-rig': rig.fig.id }, svg);
      root.style.cursor = 'pointer';
      layer = mk('g', {}, root);
      style = STICK.styles[view.style] || STICK.styles.sketch;
      nodes = style.build(rig.fig, layer);
      emoteLayer = mk('g', { class: 'emotes' }, root);
      emoteNodes.clear();
      buildAccessories();
      // slightly larger eyes: the face reads better at stage size
      const gr = (nodes.g && nodes.g.headR) || STICK.geom(rig.fig).headR;
      const f = nodes.face;
      if (f) {
        if (f.eyeN) f.eyeN.setAttribute('rx', (gr * 0.176).toFixed(3));
        if (f.eyeF) f.eyeF.setAttribute('rx', (gr * 0.176).toFixed(3));
        if (f.pupN) f.pupN.setAttribute('r', (gr * 0.086).toFixed(3));
        if (f.pupF) f.pupF.setAttribute('r', (gr * 0.086).toFixed(3));
      }
      root.addEventListener('pointerdown', ev => {
        if (!rig.pose) return;
        const p = svgPoint(ev);
        const part = hitPart(p, rig.pose);
        if (!part) return;
        ev.stopPropagation();
        rig.react(part);
        if (opts.onTouch) opts.onTouch(part, rig);
      });
    }

    function svgPoint(ev) {
      try {
        const pt = svg.createSVGPoint();
        pt.x = ev.clientX; pt.y = ev.clientY;
        const m = svg.getScreenCTM();
        if (m) return pt.matrixTransform(m.inverse());
      } catch (e) { /* fall through */ }
      const r = svg.getBoundingClientRect();
      return { x: ((ev.clientX - r.left) / r.width) * 100, y: ((ev.clientY - r.top) / r.height) * 100 };
    }

    function hitPart(p, P) {
      const cands = [
        ['head', P.world.head, P.g.headR * 1.45],
        ['torso', P.world.chest, 7.5],
        ['armL', P.world.handL, 5], ['armR', P.world.handR, 5],
        ['legL', { x: P.world.footL.x, y: P.world.footL.y - 3 }, 5],
        ['legR', { x: P.world.footR.x, y: P.world.footR.y - 3 }, 5],
      ];
      let best = null;
      for (const [name, pt, rad] of cands) {
        const d = Math.hypot(p.x - pt.x, p.y - pt.y);
        if (d <= rad && (!best || d / rad < best.score)) best = { name, score: d / rad };
      }
      return best ? best.name : null;
    }
    build();

    view.setStyle = s => {
      if (!STICK.styles[s] || s === view.style) return false;
      view.style = s;
      build();
      return true;
    };

    view.setZoom = z => {
      view.zoom = z;
      target = (z === 'face' ? FACE : FULL).slice();
    };

    // Accessories: 'wear' = crown | cape | dress | none, 'face' = mustache | glasses | ears | none
    view.setLook = (kind, value) => {
      if (kind !== 'wear' && kind !== 'face') return false;
      look[kind] = value || 'none';
      paintAccessories();
      return true;
    };
    view.getLook = () => ({ ...look });

    view.draw = t => {
      if (rig.pose) style.update(nodes, rig.pose, t);
      if (look.wear !== 'none' || look.face !== 'none') paintAccessories();
      if (manageBox) {
        let moving = false;
        for (let i = 0; i < 4; i++) {
          const d = target[i] - box[i];
          if (Math.abs(d) > 0.004) { box[i] += d * 0.22; moving = true; }
        }
        if (moving || view._wasMoving) {
          svg.setAttribute('viewBox', box.map(v => v.toFixed(3)).join(' '));
          view._wasMoving = moving;
        }
      }
      drawEmotes(t);
    };

    function makeEmoteNode(e) {
      const head = rig.pose ? rig.pose.world.head : { x: 50, y: 40 };
      const r = rig.pose ? rig.pose.g.headR : 6;
      const fc = rig.pose ? rig.pose.fc : 1;
      const g = mk('g', { class: 'emote' }, emoteLayer);
      const txt = mk('text', {
        'font-family': 'Georgia, "Times New Roman", serif',
        'font-weight': 700, 'text-anchor': 'middle', fill: '#2a2a35',
      }, g);
      txt.setAttribute('font-size', (r * 0.82).toFixed(2));
      txt.textContent = e.symbol;
      // Anchor once: the head sways slightly, and re-anchoring every frame is
      // what made switching emotes look like shaking.
      return { g, txt, anchorX: head.x + fc * r * 1.32, anchorY: head.y - r * 1.05, dying: null };
    }

    function drawEmotes(t) {
      const live = rig.emotes || [];
      const ids = new Set();
      for (const e of live) {
        ids.add(e.id);
        let n = emoteNodes.get(e.id);
        if (!n) { n = makeEmoteNode(e); emoteNodes.set(e.id, n); }
        const dur = Math.max(0.05, e.t1 - e.t0);
        const u = clamp((t - e.t0) / dur, 0, 1);
        const inK = clamp((t - e.t0) / 0.16, 0, 1);
        const outK = clamp((e.t1 - t) / 0.22, 0, 1);
        n.g.setAttribute('opacity', Math.min(inK, outK).toFixed(2));
        n.g.setAttribute('transform',
          `translate(${n.anchorX.toFixed(2)} ${(n.anchorY - u * 1.2).toFixed(2)}) ` +
          `scale(${(0.72 + 0.28 * inK).toFixed(2)})`);
      }
      for (const [id, n] of emoteNodes) {
        if (ids.has(id)) continue;
        if (!n.dying) n.dying = t;
        const k = clamp(1 - (t - n.dying) / 0.16, 0, 1);
        n.g.setAttribute('opacity', k.toFixed(2));
        if (k <= 0) { n.g.remove(); emoteNodes.delete(id); }
      }
    }

    return view;
  }

  /* ------------------------------------------------------------- exports */

  STICK.companion = {
    version: '2.0.0',
    EMOTION_NAMES,
    GESTURE_NAMES,
    GESTURE_LABELS,
    EMOTIONS,
    GESTURES,
    createRig,
    mount,
    speechLevel,
  };
})();

