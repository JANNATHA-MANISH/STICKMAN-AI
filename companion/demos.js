/* stick — Demo catalogue for the companion Demo panel.
 *
 * One flat list of everything worth showing, grouped by how the app performs it:
 *
 *   Speak   → kind "speak"   : a line, spoken.  (text [+ emotion])
 *   Perform → kind "perform" : a line + a real gesture in the rig's GESTURES
 *                              table (wave, nod, shrugOnce, clapOnce, thinkChin,
 *                              head_tilt, point, bow, facepalm, hopJoy, dance).
 *   Action  → kind "action"  : a prompt for the action director (voice/director.py),
 *                              which may only emit beats with a scenario from
 *                              action.js SCENARIOS:
 *                                walk, run, dance, handshake, jump, fight, clash,
 *                                classroom, lecture, table, family, think,
 *                                present, approach, faceoff, moonwalk, sillywalk
 *
 * Honesty rule used here: an item is supported:true only when the app really
 * stages its defining beat. Everything that needs a subsystem the companion
 * stager does not have (hand props, custom joint clips, camera moves, scene
 * fades, mood timelines, multi-waypoint paths, sound effects, style mixing or
 * age variants) is supported:false with a one-line `note` saying why.
 *
 * SCENE HINT VALUES — two namespaces, both accepted by the UI:
 *   1. scenes.js renderers (window.StickScenes.renderers):
 *      juggler, floatingHeads, breakingNews, naptime, flowchart, balloons,
 *      beards, flowers, guidedTour, pitch, sunsetGlow
 *   2. app.js built-in scene keys (app.js SCENES):
 *      paper, dawn, meadow, loft, dusk, night, snow, cabin, aquarium,
 *      daylight, garden, ghost, space
 *
 * NOTE for whoever wires the Demo button: app.js registers the scenes.js
 * library renderers under shorter keys, so applyScene() needs the app key:
 *      floatingHeads -> heads      breakingNews -> news
 *      guidedTour    -> tour       pitch        -> pitchdeck
 *      sunsetGlow    -> sunsetglow
 * (juggler, naptime, flowchart, balloons, beards, flowers are identical in both.)
 * Resolving either namespace keeps every `scene` below usable as-is.
 *
 * Plain ES2017, no deps, no DOM at load time. Only window.StickDemos is exported.
 */
(function () {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;

  /* ------------------------------------------------------------------ speak */

  const SPEAK = [
    {
      id: 'speak-greeting',
      label: 'Say hello',
      kind: 'speak',
      text: 'Hello! Good to see you — come on in.',
      emotion: 'happy',
    },
    {
      id: 'speak-good-news',
      label: 'Good news',
      kind: 'speak',
      text: 'Good news: we shipped it, and nothing caught fire.',
      emotion: 'ecstatic',
    },
    {
      id: 'speak-thinking',
      label: 'Thinking aloud',
      kind: 'speak',
      text: 'Hmm. There has to be a simpler way to say this.',
      emotion: 'thinking',
    },
    {
      id: 'speak-apology',
      label: 'Apologize',
      kind: 'speak',
      text: 'I am sorry — that mix-up was entirely my fault.',
      emotion: 'worried',
    },
    {
      id: 'speak-excited',
      label: 'Big excitement',
      kind: 'speak',
      text: 'This is going to be the best thing we have ever made!',
      emotion: 'ecstatic',
    },
    {
      id: 'speak-question',
      label: 'Ask a question',
      kind: 'speak',
      text: 'So what happens next — do we wait, or do we start?',
      emotion: 'confused',
    },
  ];

  /* ---------------------------------------------------------------- perform */

  const PERFORM = [
    {
      id: 'perform-wave',
      label: 'Wave hello',
      kind: 'perform',
      text: 'Hi there! Over here!',
      emotion: 'happy',
      gesture: 'wave',
    },
    {
      id: 'perform-nod',
      label: 'Agree with a nod',
      kind: 'perform',
      text: 'Right, that makes sense to me.',
      emotion: 'neutral',
      gesture: 'nod',
    },
    {
      id: 'perform-shrug',
      label: 'Shrug it off',
      kind: 'perform',
      text: 'No idea, honestly. Your guess is as good as mine.',
      emotion: 'confused',
      gesture: 'shrugOnce',
    },
    {
      id: 'perform-clap',
      label: 'Give a clap',
      kind: 'perform',
      text: 'That was excellent work, all of you.',
      emotion: 'proud',
      gesture: 'clapOnce',
    },
    {
      id: 'perform-think',
      label: 'Think it over',
      kind: 'perform',
      text: 'Give me a second. There is a tidy way to do this.',
      emotion: 'thinking',
      gesture: 'thinkChin',
    },
    {
      id: 'perform-tilt',
      label: 'Curious head tilt',
      kind: 'perform',
      text: 'Wait — say that part again?',
      emotion: 'confused',
      gesture: 'head_tilt',
    },
    {
      id: 'perform-point',
      label: 'Point it out',
      kind: 'perform',
      text: 'Look — right there, on the board.',
      emotion: 'neutral',
      gesture: 'point',
    },
    {
      id: 'perform-bow',
      label: 'Take a bow',
      kind: 'perform',
      text: 'Thank you, thank you. You are too kind.',
      emotion: 'proud',
      gesture: 'bow',
    },
    {
      id: 'perform-facepalm',
      label: 'Facepalm',
      kind: 'perform',
      text: 'I sent it to the wrong list. Again.',
      emotion: 'embarrassed',
      gesture: 'facepalm',
    },
    {
      id: 'perform-hop',
      label: 'Hop with joy',
      kind: 'perform',
      text: 'We won! We actually won!',
      emotion: 'ecstatic',
      gesture: 'hopJoy',
    },
  ];

  /* ----------------------------------------------------------------- action
     Order follows js/examples.js so the catalogue reads like the studio reel,
     then the two extras that have no studio counterpart (family dinner, rocket
     launch). Extras that duplicate a studio animation are the SAME item here —
     no duplicate ids, e.g. "Moonwalk" is this one moonwalk entry, and
     "Balloons" is the balloon entry, since the app stages one balloon scene. */

  const ACTION = [
    {
      id: 'props',
      label: 'Props handoff',
      kind: 'action',
      prompt: 'One person hands a ball to another, who catches it and hands back a cup of coffee.',
      scene: 'paper',
      supported: false,
      note: 'No prop-in-hand system: give / throw / catch / hand off cannot be staged.',
    },
    {
      id: 'three-styles',
      label: 'Three styles',
      kind: 'action',
      prompt: 'Three figures side by side, each drawn in a different style, wave at the viewer together.',
      scene: 'paper',
      supported: false,
      note: 'The stage draws in one global style, so ink + sketch + toon cannot share a frame.',
    },
    {
      id: 'hello-wave',
      label: 'Hello wave',
      kind: 'action',
      prompt: 'walks in and waves hello to the viewer, pleased with itself.',
      scene: 'paper',
      supported: false,
      note: 'The action director has no wave beat — use Perform › "Wave hello" for a real wave.',
    },
    {
      id: 'classroom',
      label: 'Classroom',
      kind: 'action',
      prompt: 'A professor walks to the board, writes the topic and explains it while the student looks lost.',
      scene: 'loft',
      supported: true,
    },
    {
      id: 'moonwalk',
      label: 'Moonwalk',
      kind: 'action',
      prompt: 'Slides into a moonwalk across the stage while a fan claps and shouts.',
      scene: 'night',
      supported: true,
    },
    {
      id: 'john-cleese-silly-walks',
      label: 'Silly walk',
      kind: 'action',
      prompt: 'Performs a silly walk across the stage, stiff-legged and straight-faced, then bows.',
      scene: 'daylight',
      supported: true,
    },
    {
      id: 'juggler',
      label: 'Juggler',
      kind: 'action',
      prompt: 'Juggles three balls in the air, then dances a proud celebration when nothing is dropped.',
      scene: 'juggler',
      supported: true,
    },
    {
      id: 'lecture',
      label: 'Lecture',
      kind: 'action',
      prompt: 'A professor at the chalkboard explains supply and demand, writes both curves and points at where they meet.',
      scene: 'paper',
      supported: true,
    },
    {
      id: 'standup',
      label: 'Standup',
      kind: 'action',
      prompt: 'Writes the sprint goals on the board, nods, and presents the three things shipping this week.',
      scene: 'paper',
      supported: true,
    },
    {
      id: 'journey',
      label: 'Journey',
      kind: 'action',
      prompt: 'walks a long way while the scenery changes around them and the camera follows.',
      scene: 'meadow',
      supported: false,
      note: 'Needs the studio camera rig (camera.follow) plus timed scene fades; stagings have no camera beats.',
    },
    {
      id: 'the-pitch',
      label: 'The pitch',
      kind: 'action',
      prompt: 'Presents a growth chart at the board to a bored investor and insists the line only goes up.',
      scene: 'pitch',
      supported: true,
    },
    {
      id: 'motivation',
      label: 'Motivation',
      kind: 'action',
      prompt: 'A seminar guru lectures at the chalkboard about believing in yourself and momentum.',
      scene: 'paper',
      supported: true,
    },
    {
      id: 'breaking-news',
      label: 'Breaking news',
      kind: 'action',
      prompt: 'A news anchor presents a breaking story straight to camera, then reacts to it.',
      scene: 'breakingNews',
      supported: true,
    },
    {
      id: 'marginal-cost',
      label: 'Marginal cost',
      kind: 'action',
      prompt: 'A professor explains marginal cost at the chalkboard: the derivative of total cost, the slope of the cost curve.',
      scene: 'paper',
      supported: true,
    },
    {
      id: 'naptime',
      label: 'Naptime',
      kind: 'action',
      prompt: 'After a long day the kid yawns, walks off to bed and says goodnight.',
      scene: 'naptime',
      supported: true,
    },
    {
      id: 'floating-heads',
      label: 'Floating heads',
      kind: 'action',
      prompt: 'Two friends approach each other and take turns explaining the idea to camera with wide gestures.',
      scene: 'floatingHeads',
      supported: true,
    },
    {
      id: 'feelings',
      label: 'Feelings',
      kind: 'action',
      prompt: 'A close-up drifts from happy to sad to surprised while the figure talks quietly.',
      scene: 'paper',
      supported: false,
      note: 'Per-beat mood changes plus camera focus are not action beats; a scenario sets one emotion only.',
    },
    {
      id: 'family-walk',
      label: 'Family walk',
      kind: 'action',
      prompt: 'A family strolls along together while the kids run ahead and ask if we are there yet.',
      scene: 'meadow',
      supported: true,
    },
    {
      id: 'three-generations',
      label: 'Three generations',
      kind: 'action',
      prompt: 'A kid, a parent and a grandparent walk at three different speeds and bicker about keeping up.',
      scene: 'meadow',
      supported: false,
      note: 'Age variants are cast settings, not scenarios; the stager stages one speaker plus one partner.',
    },
    {
      id: 'cheers',
      label: 'Cheers',
      kind: 'action',
      prompt: 'Two friends meet at the table and toast a good week, grinning at each other.',
      scene: 'loft',
      supported: true,
    },
    {
      id: 'en-garde',
      label: 'En garde',
      kind: 'action',
      prompt: 'Squares up to an opponent, lunges and clashes — have at you!',
      scene: 'paper',
      supported: true,
    },
    {
      id: 'balloon',
      label: 'Balloon',
      kind: 'action',
      prompt: 'The kid walks along under a sky of drifting balloons and calls after them as they rise.',
      scene: 'balloons',
      supported: true,
    },
    {
      id: 'emotions',
      label: 'Emotions',
      kind: 'action',
      prompt: 'One close-up runs laughing, confused, crying, in love and proud in a single take.',
      scene: 'paper',
      supported: false,
      note: 'Five moods in one take needs a mood timeline and camera close-ups; neither is an action beat.',
    },
    {
      id: 'intensity',
      label: 'Intensity',
      kind: 'action',
      prompt: 'Three figures show the same anger at half, normal and maximum intensity.',
      scene: 'paper',
      supported: false,
      note: 'The intensity dial is not a scenario, and the stager speaks every beat at intensity 1.',
    },
    {
      id: 'mood-gallery',
      label: 'Mood gallery',
      kind: 'action',
      prompt: 'A face runs through every mood the engine ships, one caption per mood.',
      scene: 'paper',
      supported: false,
      note: 'A captioned mood reel is a mood timeline with scene captions, not a physical scene to direct.',
    },
    {
      id: 'sunset',
      label: 'Sunset',
      kind: 'action',
      prompt: 'walks at golden hour, then stops to watch the light fade and says what a view.',
      scene: 'sunsetGlow',
      supported: true,
    },
    {
      id: 'daydream',
      label: 'Daydream',
      kind: 'action',
      prompt: 'Sits through double maths, thinks about lunch instead and daydreams the lesson away.',
      scene: 'loft',
      supported: true,
    },
    {
      id: 'flowchart',
      label: 'Flowchart',
      kind: 'action',
      prompt: 'Presents the plan on the board — idea, then ship it, then profit — pointing at each step.',
      scene: 'flowchart',
      supported: true,
    },
    {
      id: 'detour',
      label: 'Detour',
      kind: 'action',
      prompt: 'walks along the path, steps around a puddle in the middle of it, and carries on.',
      scene: 'meadow',
      supported: false,
      note: 'Needs a multi-waypoint walk (move with via points); the stager only walks in a straight line.',
    },
    {
      id: 'celebrate',
      label: 'Celebrate',
      kind: 'action',
      prompt: 'Dances with joy, arms up, and celebrates the win to whoever is listening.',
      scene: 'paper',
      supported: true,
    },
    {
      id: 'moving-day',
      label: 'Moving day',
      kind: 'action',
      prompt: 'Lifts a heavy box, carries it across the room, drops it and admits it is heavy.',
      scene: 'loft',
      supported: false,
      note: 'The box is a hand prop; the stager cannot give, carry or drop a prop.',
    },
    {
      id: 'sound-effects',
      label: 'Sound effects',
      kind: 'action',
      prompt: 'Hops, throws a ball, and reacts as a boing, a whoosh and a coin sound land.',
      scene: 'paper',
      supported: false,
      note: 'There is no sfx beat in the action director, so boing / whoosh / coin cannot fire.',
    },
    {
      id: 'flowers',
      label: 'Flowers',
      kind: 'action',
      prompt: 'The visitor walks into a garden in bloom, stops among the flowers and says they are beautiful.',
      scene: 'flowers',
      supported: true,
    },
    {
      id: 'beards',
      label: 'Beards',
      kind: 'action',
      prompt: 'Two friends sit at the table comparing beards — full, goatee, stubble — and trade compliments.',
      scene: 'beards',
      supported: true,
    },
    {
      id: 'guided-tour',
      label: 'Guided tour',
      kind: 'action',
      prompt: 'walks a visitor through the studio, presenting and pointing out each thing worth seeing.',
      scene: 'guidedTour',
      supported: true,
    },
    {
      id: 'family-dinner',
      label: 'Family dinner',
      kind: 'action',
      prompt: 'A family sits around the table for dinner and argues cheerfully about their day.',
      scene: 'loft',
      supported: true,
    },
    {
      id: 'rocket-launch',
      label: 'Rocket launch',
      kind: 'action',
      prompt: 'Explains the rocket launch at the board — countdown, orbit, splashdown — while the countdown runs.',
      scene: 'space',
      supported: true,
    },
  ];

  /* -------------------------------------------------------------- catalogue */

  G.StickDemos = {
    groups: [
      { name: 'Speak', items: SPEAK },
      { name: 'Perform', items: PERFORM },
      { name: 'Action', items: ACTION },
    ],
    all() { return this.groups.flatMap(g => g.items); },
    find(id) { return this.all().find(i => i.id === id) || null; },
  };
})();
