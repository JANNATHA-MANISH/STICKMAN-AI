/* Headless checks for the companion rig â€” no DOM, no browser.
   Run: node companion/test-rig.js   (from the repository root) */
'use strict';
global.window = undefined;

const path = require('path');
const load = f => require(path.join(__dirname, '..', 'js', f));
['presets.js', 'engine.js', 'figure.js', 'scene.js', 'props.js', 'board.js', 'commands.js']
  .forEach(load);
require(path.join(__dirname, 'companion.js'));

const STICK = globalThis.STICK;
const { createRig } = STICK.companion;

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL: ' + msg); } };
const near = (a, b, eps, msg) => ok(Math.abs(a - b) <= eps, `${msg} (got ${a}, want ~${b})`);

function run(rig, secs, dt = 1 / 60) {
  let t = rig.t;
  const n = Math.max(1, Math.round(secs / dt));
  const trace = [];
  for (let i = 0; i < n; i++) {
    t += dt;
    rig.step(dt, t);
    trace.push({ t, smile: rig.value('smile'), shR: rig.value('shR'), mouth: rig.value('mouthOpen'),
      eye: rig.value('eyeOpen'), faceEye: rig.pose.face.eyeOpen, bend: rig.value('bend'),
      headTilt: rig.value('headTilt'), y: rig.value('y'),
      headX: rig.pose.world.head.x, headY: rig.pose.world.head.y });
  }
  return trace;
}
const maxStep = (trace, key) => {
  let m = 0;
  for (let i = 1; i < trace.length; i++) m = Math.max(m, Math.abs(trace[i][key] - trace[i - 1][key]));
  return m;
};
const finitePose = P => P && ['pelvis', 'neck', 'headC', 'sh'].every(k => P[k] && isFinite(P[k].x) && isFinite(P[k].y))
  && isFinite(P.armR.hand.x) && isFinite(P.legL.ank.y);

console.log('rig: neutral');
{
  const rig = createRig();
  const tr = run(rig, 1.0);
  ok(finitePose(rig.pose), 'neutral pose is finite');
  // the idle 'calm' pose adds a gentle smile on top of the neutral baseline
  near(rig.value('smile'), 0.25, 0.10, 'neutral smile (idle calm)');
  ok(rig.pose.face.show === 1 && rig.pose.face.front === 1, 'front-facing figure shows the face');
  ok(tr.length === 60, 'one second of frames');
}

console.log('rig: emotion transition is smooth (no snap, no reset)');
{
  const rig = createRig();
  run(rig, 0.5);
  rig.setEmotion('happy', { intensity: 0.9, duration: 500 });
  const tr = run(rig, 2.0);
  ok(rig.value('smile') > 0.55, 'happy smile reached: ' + rig.value('smile').toFixed(2));
  ok(rig.value('browRaise') > 0.15, 'happy browRaise: ' + rig.value('browRaise').toFixed(2));
  ok(maxStep(tr, 'smile') < 0.18, 'smile never jumps: max step ' + maxStep(tr, 'smile').toFixed(3));
  ok(finitePose(rig.pose), 'happy pose finite');

  rig.setEmotion('sad', { intensity: 1, duration: 500 });
  const tr2 = run(rig, 2.0);
  ok(rig.value('smile') < -0.3, 'sad smile: ' + rig.value('smile').toFixed(2));
  ok(rig.value('headTilt') > 0.05, 'sad headTilt: ' + rig.value('headTilt').toFixed(2));
  ok(maxStep(tr2, 'smile') < 0.18, 'happyâ†’sad cross-fade smooth: max step ' + maxStep(tr2, 'smile').toFixed(3));
}

console.log('rig: gestures');
{
  const rig = createRig();
  run(rig, 0.4);
  const rest = rig.value('shR');
  ok(rig.gesture('wave').ok, 'wave accepted');
  const tr = run(rig, 0.6);
  ok(tr[0].shR < 6 && tr[1].shR < 14, 'wave fades in instead of snapping on');
  ok(rig.value('shR') > 60, 'wave raises the arm: shR ' + rig.value('shR').toFixed(1));
  const tail = run(rig, 1.9);
  ok(maxStep(tail.slice(-40), 'shR') < 14, 'wave settles without snapping back');
  near(rig.value('shR'), rest, 3, 'wave returns to rest');

  rig.gesture('nod');
  const nod = run(rig, 0.8);
  ok(Math.max(...nod.map(x => x.headTilt)) > 0.08,
    'nod lowers the head: peak headTilt ' + Math.max(...nod.map(x => x.headTilt)).toFixed(2));
  run(rig, 1.0);
  near(rig.value('headTilt'), 0, 0.06, 'nod returns the head');

  rig.gesture('cough');
  const tr3 = run(rig, 0.2);
  ok(rig.value('bend') > 0.08, 'cough bends forward: bend ' + rig.value('bend').toFixed(2));
  ok(maxStep(tr3, 'bend') < 0.12, 'cough ramps smoothly');
  ok(rig.gesture('nope').ok === false, 'unknown gesture rejected');
}

console.log('rig: every mood the repo ships');
{
  const names = STICK.companion.EMOTION_NAMES;
  ok(names.length >= 18, 'all repo moods exposed (' + names.length + ')');
  for (const name of names) {
    const r = createRig();
    const res = r.setEmotion(name, { intensity: 1, duration: 300 });
    ok(res.ok, 'emotion "' + name + '" accepted');
    run(r, 1.2);
    ok(finitePose(r.pose), 'emotion "' + name + '" pose finite');
  }
  const r = createRig();
  r.setEmotion('sleepy', { intensity: 1, duration: 300 });
  run(r, 3.5);
  ok(r.emotes.some(e => e.symbol === 'zzz'), 'sleepy pops a zzz emote');
  const l = createRig();
  l.setEmotion('love', { intensity: 1, duration: 300 });
  ok(l.emotes.some(e => e.symbol === '♥'), 'love pops a heart emote');
}

console.log('rig: every built-in clip plays as a gesture');
{
  const names = STICK.companion.GESTURE_NAMES;
  ok(names.length >= 14, 'all clips exposed as gestures (' + names.length + ')');
  for (const name of names) {
    const r = createRig();
    run(r, 0.2);
    const res = r.gesture(name);
    ok(res.ok, 'gesture "' + name + '" accepted');
    const def = STICK.companion.GESTURES[name];
    let moved = false, yMin = 999, yMax = -999, bad = false;
    let t = r.t;
    for (let i = 0; i < Math.round((def.dur + 0.5) * 60); i++) {
      t += 1 / 60;
      r.step(1 / 60, t);
      if (!finitePose(r.pose)) { bad = true; break; }
      const y = r.value('y'); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
      if (Math.abs(r.value('shL')) > 25 || Math.abs(r.value('shR')) > 25 ||
          Math.abs(r.value('elR') - 8) > 30 || Math.abs(r.value('elL') - 8) > 30 ||
          Math.abs(r.value('headTilt')) > 0.1 || Math.abs(r.value('bend') - 0.02) > 0.06 ||
          Math.abs(r.value('kneeL')) > 12 || Math.abs(r.value('tilt')) > 1) moved = true;
    }
    ok(!bad, 'gesture "' + name + '" keeps a finite pose');
    ok(moved, 'gesture "' + name + '" moves the body');
    ok(yMax - yMin < 8, 'gesture "' + name + '" keeps the character near the floor');
    run(r, 0.8);
    ok(Math.abs(r.value('shR')) < 6 && Math.abs(r.value('kneeL')) < 3,
      'gesture "' + name + '" returns to rest');
  }
}

console.log('rig: speech, blink, gaze, and layers together');
{
  const rig = createRig();
  rig.setEmotion('happy', { intensity: 1, duration: 300 });
  run(rig, 1.0);
  rig.startSpeech('Hello there, I am your stickman companion.');
  const tr = run(rig, 2.0);
  const mouth = tr.map(x => x.mouth);
  ok(Math.max(...mouth) > 0.5, 'speech opens the mouth');
  ok(Math.max(...mouth) > 0.75, 'mouth opens wide enough to read at stage size (peak ' +
    Math.max(...mouth).toFixed(2) + ')');
  ok(Math.max(...mouth) - Math.min(...mouth) > 0.25, 'speech mouth moves (range ' +
    (Math.max(...mouth) - Math.min(...mouth)).toFixed(2) + ')');
  ok(rig.value('smile') > 0.5, 'smile survives speaking (layer stacking)');
  ok(rig.value('browRaise') > 0.2, 'brow is still raised while speaking');
  ok(Math.abs(rig.value('shR')) > 2 || Math.abs(rig.value('elR') - 8) > 5,
    'hands move while talking (talk-gesture layer)');

  // audio-driven mouth: an external level takes over the jaw
  rig.setAudioLevel(0.95);
  run(rig, 0.25);
  ok(rig.value('mouthOpen') > 0.85, 'audio level drives the mouth (' + rig.value('mouthOpen').toFixed(2) + ')');
  rig.setAudioLevel(0);
  run(rig, 0.4);

  rig.setSinging(true);
  const sing = run(rig, 1.2);
  ok(Math.max(...sing.map(x => x.mouth)) > 0.3, 'singing keeps the mouth open');
  ok(rig.emotes.some(e => e.symbol === '♪'), 'singing pops a music note');
  rig.setSinging(false);
  run(rig, 0.4);
  ok(rig.value('mouthOpen') < 0.2, 'singing stops cleanly');

  rig.blink();
  const eye = [];
  const tr2 = run(rig, 0.3);
  tr2.forEach(x => eye.push(x.eye));
  ok(Math.min(...eye) < 0.6, 'blink closes the eyes: min ' + Math.min(...eye).toFixed(2));
  run(rig, 0.4);
  ok(rig.value('eyeOpen') > 0.7, 'eyes reopen after the blink');

  rig.lookAt(0.8, -0.4);
  run(rig, 0.5);
  ok(rig.value('pupX') > 0.4, 'gaze moves right: pupX ' + rig.value('pupX').toFixed(2));
  ok(rig.value('pupY') < -0.1, 'gaze moves up: pupY ' + rig.value('pupY').toFixed(2));

  rig.emote('idea');
  ok(rig.emotes.length > 0, 'emote event accepted');

  rig.stopSpeech();
  run(rig, 0.8);
  ok(rig.value('mouthOpen') < 0.12, 'mouth closes after speech stops: ' + rig.value('mouthOpen').toFixed(2));
}

console.log('rig: idle life and automatic blinking');
{
  const rig = createRig();
  const tr = run(rig, 8);
  const hx = tr.map(x => x.headX);
  ok(Math.max(...hx) - Math.min(...hx) > 0.12,
    'breathing/sway moves the head (' + (Math.max(...hx) - Math.min(...hx)).toFixed(3) + ' units horizontally)');
  const eyes = tr.map(x => x.faceEye);
  ok(Math.min(...eyes) < 0.5, 'the engine auto-blinks over 8s (min face eyeOpen ' + Math.min(...eyes).toFixed(2) + ')');
  // an autonomous stroll legitimately moves the head faster than breathing,
  // so allow a walking-sized step but still catch teleports/NaN jumps
  ok(maxStep(tr, 'headX') < 1.2, 'idle motion is smooth (no teleports)');
}

console.log('adapter: structured events');
{
  const rig = createRig();
  const cases = [
    [{ type: 'emotion', value: 'surprised', intensity: 0.8, duration: 500 }, true],
    [{ type: 'gesture', value: 'wave' }, true],
    [{ type: 'speech', value: 'speaking' }, true],
    [{ type: 'speech', value: 'stopped' }, true],
    [{ type: 'gaze', value: 'auto' }, true],
    [{ type: 'blink' }, true],
    [{ type: 'emotion', value: 'furious' }, false],
    [{ type: 'gesture', value: 'backflip' }, false],
    [{ type: 'speech', value: 'maybe' }, false],
    [{ nope: 1 }, false],
    [null, false],
  ];
  for (const [ev, want] of cases) {
    const r = rig.apply(ev);
    ok(r.ok === want, `apply ${JSON.stringify(ev)} -> ${want} (got ${r.ok})`);
  }
  const angry = createRig();          // fresh rig: a running wave would own the hand
  angry.apply({ type: 'emotion', value: 'angry', intensity: 1, duration: 400 });
  run(angry, 1.5);
  ok(angry.value('handR') === 'fist', 'angry clenches the fists (matches cmd mood)');
  const s = angry.state();
  ok(s.emotion === 'angry' && s.intensity > 0.9, 'state reports emotion: ' + JSON.stringify(s));
}

console.log('fuzz: 20s of random events, no NaN, no throws');
{
  const rig = createRig();
  const emos = STICK.companion.EMOTION_NAMES, gests = STICK.companion.GESTURE_NAMES;
  const rnd = seeded(7);
  let worst = 0;
  for (let i = 0; i < 1200; i++) {
    const pick = rnd();
    if (pick < 0.02) rig.apply({ type: 'emotion', value: emos[Math.floor(rnd() * emos.length)], intensity: rnd() * 1.5 });
    else if (pick < 0.035) rig.apply({ type: 'gesture', value: gests[Math.floor(rnd() * gests.length)] });
    else if (pick < 0.045) rig.apply({ type: rnd() < 0.5 ? 'speech' : 'speak', value: 'speaking', text: 'hi there' });
    else if (pick < 0.055) rig.apply({ type: 'speech', value: 'stopped' });
    else if (pick < 0.065) rig.apply({ type: 'blink' });
    else if (pick < 0.07) rig.apply({ type: 'gaze', x: rnd() * 2 - 1, y: rnd() * 2 - 1 });
    rig.step(1 / 60, i / 60);
    const P = rig.pose;
    if (!finitePose(P)) { ok(false, 'non-finite pose at frame ' + i); break; }
    worst = Math.max(worst, Math.abs(rig.value('bend')), Math.abs(rig.value('headTilt')));
  }
  ok(worst < 5, 'channels stay in a sane range (worst ' + worst.toFixed(2) + ')');
}

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall companion rig checks passed');

