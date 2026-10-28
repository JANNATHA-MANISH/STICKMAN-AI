/* ============================================================================
 * Stick — Companion Studio · stage recorder
 * ----------------------------------------------------------------------------
 * window.StickRecorder.start({ svg, width, height, fps, background })
 *
 * Why this exists
 * ---------------
 * The previous recorder cloned the live <svg> every frame, serialised it to a
 * data: URL, decoded it into an <img> and drew that onto a canvas.  A
 * serialised SVG is inert: the image document never loads companion.css, so
 * every CSS-driven animation (fish, bubbles, weeds, ghosts, clouds, snow,
 * stars, flames) was frozen at the animation's 0% keyframe, and the per-frame
 * serialise + decode cost dropped frames.
 *
 * What this does instead
 * ----------------------
 *  1. A single stage canvas of opts.width x opts.height.
 *  2. A hidden *mirror* clone of the source SVG that stays attached to the
 *     document (positioned off-screen, never display:none) so that its CSS
 *     animations really run and it stays a faithful, rendered copy.
 *  3. Every frame:
 *       - paint the background gradient by hand (cheap),
 *       - draw a cached "base" raster of the mirror (static content: figures,
 *         props, boards, text) refreshed every few frames, and
 *       - redraw the animated elements *procedurally* from their LIVE current
 *         state, read from the source SVG with getComputedStyle()/matrices.
 *     The animated elements are stripped from the base raster, so nothing is
 *     drawn twice and nothing is left frozen.
 *
 * On reading the current animation state
 * --------------------------------------
 * `getCTM()` / `getScreenCTM()` describe the SVG *layout* transform; in
 * Chromium they do not include the matrix contributed by a running CSS
 * animation, which is exactly the state that has to be captured here (leaning
 * on them is what leaves the fish frozen).  So the authoritative read is
 * `getComputedStyle(el).transform`, which resolves to the currently animated
 * matrix, composed with the ancestor transform chain and the viewBox mapping
 * derived from `getBoundingClientRect()`.  That last part is why a camera
 * zoom or a resized stage mid-take still lands in the right place, and why
 * elements whose CSS animation overrides their transform attribute are
 * reproduced exactly as the screen shows them.
 *
 * Fallback
 * --------
 * The whole advanced path is wrapped in try/catch.  If any step throws (no
 * getComputedStyle, no viewBox, a stage with no measurable size, a canvas that
 * refuses drawImage, ...) the recorder degrades to the old behaviour: clone +
 * serialise the live SVG each frame and blit it.  Recording never stops with
 * nothing to show because `stop()` always resolves.
 *
 * Encoding: WebM only (VP9 -> VP8 -> WebM).  Chromium can also write a
 * fragmented ISO-BMFF container, but most players refuse to open those files,
 * so that family is never requested here.
 *
 * Plain ES2017, no imports, no build step, no dependencies.
 * ==========================================================================*/
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* Elements whose motion comes from CSS and therefore has to be redrawn by
     hand.  Kept in sync with companion.css. */
  var ANIMATED_SELECTOR = [
    '.tank-swim', '.tank-bubble', '.tank-weed',
    '.cloud', '.ghost-bulb', '.ghost-glow', '.ghost-float',
    '.flake', '.star', '.rocket-flame', '.tree'
  ].join(',');

  /* Order matters: VP9 first, VP8, then plain WebM. */
  var MIME_TYPES = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];

  var VIDEO_BITS_PER_SECOND = 6000000;
  var BASE_REFRESH_FRAMES = 6;      /* static raster refresh cadence (~200ms @30fps) */
  var STOP_TIMEOUT_MS = 5000;       /* stop() must settle even if the recorder hangs */
  var SETUP_TIMEOUT_MS = 3000;      /* stop() must not wait forever on a stuck setup */
  var SNAPSHOT_TIMEOUT_MS = 1500;
  var SIMPLE_FRAME_TIMEOUT_MS = 300;
  var MAX_ADVANCED_FAILURES = 6;    /* ~200ms of grace before degrading */
  var MAX_DEPTH = 8;
  var TAU = Math.PI * 2;

  /* Tags that never paint anything themselves. */
  var SKIP_TAGS = {
    defs: 1, clippath: 1, mask: 1, lineargradient: 1, radialgradient: 1,
    stop: 1, title: 1, desc: 1, metadata: 1, style: 1, script: 1, symbol: 1,
    marker: 1, pattern: 1, filter: 1, text: 1, tspan: 1, textpath: 1,
    image: 1, use: 1, foreignobject: 1, animate: 1, animatetransform: 1,
    animatecolor: 1, animatemotion: 1, set: 1
  };

  /* --------------------------------------------------------------- helpers */

  function toInt(value, dflt) {
    var n = parseInt(value, 10);
    return isFinite(n) && n > 0 ? n : dflt;
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function normaliseBackground(value) {
    var out = [];
    if (typeof value === 'string' && value) {
      out = [value, value];
    } else if (value && typeof value.length === 'number') {
      for (var i = 0; i < value.length; i++) {
        if (typeof value[i] === 'string' && value[i]) out.push(value[i]);
      }
    }
    if (!out.length) out = ['#f4f1ea', '#eae4d7'];
    if (out.length === 1) out.push(out[0]);
    return out;
  }

  function clampAlpha(v) {
    if (!isFinite(v)) return 1;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  /* ------------------------------------------------------- 2D affine maths */
  /* Matrices are plain {a,b,c,d,e,f} objects, same order as Canvas2D.        */

  function identity() {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }

  function isIdentity(m) {
    return !!m && m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
  }

  function multiply(m1, m2) {
    return {
      a: m1.a * m2.a + m1.c * m2.b,
      b: m1.b * m2.a + m1.d * m2.b,
      c: m1.a * m2.c + m1.c * m2.d,
      d: m1.b * m2.c + m1.d * m2.d,
      e: m1.a * m2.e + m1.c * m2.f + m1.e,
      f: m1.b * m2.e + m1.d * m2.f + m1.f
    };
  }

  function translate(x, y) {
    return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
  }

  function scaleMatrix(x, y) {
    return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
  }

  function isFiniteMatrix(m) {
    return !!m && isFinite(m.a) && isFinite(m.b) && isFinite(m.c) &&
      isFinite(m.d) && isFinite(m.e) && isFinite(m.f);
  }

  /* "matrix(a,b,c,d,e,f)" / "matrix3d(...)" -> {a..f} */
  function parseMatrixString(raw) {
    if (!raw) return null;
    var text = String(raw).trim();
    if (!text || text === 'none') return null;

    var m2 = /^matrix\(([^)]*)\)$/.exec(text);
    if (m2) {
      var p = m2[1].split(',').map(parseFloat);
      if (p.length === 6 && p.every(isFinite)) {
        return { a: p[0], b: p[1], c: p[2], d: p[3], e: p[4], f: p[5] };
      }
      return null;
    }

    var m3 = /^matrix3d\(([^)]*)\)$/.exec(text);
    if (m3) {
      var q = m3[1].split(',').map(parseFloat);
      if (q.length === 16 && q.every(isFinite)) {
        /* column-major: m11 m12 m13 m14 | m21 ... */
        return { a: q[0], b: q[1], c: q[4], d: q[5], e: q[12], f: q[13] };
      }
    }
    return null;
  }

  /* Minimal SVG transform-list parser, used when the DOM API is unavailable. */
  function parseTransformAttribute(raw) {
    if (!raw) return null;
    var m = identity();
    var found = false;
    var re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
    var hit = re.exec(String(raw));
    while (hit) {
      var fn = hit[1];
      var args = hit[2].split(/[\s,]+/).filter(function (s) { return s !== ''; }).map(parseFloat);
      var ok = args.length > 0 && args.every(isFinite);
      var step = null;

      if (ok) {
        if (fn === 'matrix' && args.length >= 6) {
          step = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
        } else if (fn === 'translate') {
          step = translate(args[0], args.length > 1 ? args[1] : 0);
        } else if (fn === 'scale') {
          step = scaleMatrix(args[0], args.length > 1 ? args[1] : args[0]);
        } else if (fn === 'rotate') {
          var rad = args[0] * Math.PI / 180;
          var cos = Math.cos(rad);
          var sin = Math.sin(rad);
          step = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
          if (args.length >= 3) {
            step = multiply(multiply(translate(args[1], args[2]), step), translate(-args[1], -args[2]));
          }
        } else if (fn === 'skewX') {
          step = { a: 1, b: 0, c: Math.tan(args[0] * Math.PI / 180), d: 1, e: 0, f: 0 };
        } else if (fn === 'skewY') {
          step = { a: 1, b: Math.tan(args[0] * Math.PI / 180), c: 0, d: 1, e: 0, f: 0 };
        }
      }

      if (step) {
        m = multiply(m, step);
        found = true;
      }
      hit = re.exec(String(raw));
    }
    return found ? m : null;
  }

  /* ------------------------------------------------------------- geometry */

  function numAttr(el, name, dflt) {
    var v = parseFloat(el.getAttribute(name));
    return isFinite(v) ? v : dflt;
  }

  function pointsAttr(el) {
    var raw = String(el.getAttribute('points') || '').trim();
    if (!raw) return [];
    return raw.split(/[\s,]+/).map(parseFloat).filter(isFinite);
  }

  /* Builds a small descriptor for the shapes Canvas2D can reproduce. */
  function buildGeometry(el, tag) {
    var g = { tag: tag, d: '', cx: 0, cy: 0, r: 0, rx: 0, ry: 0, x: 0, y: 0, w: 0, h: 0, x1: 0, y1: 0, x2: 0, y2: 0, points: [] };

    if (tag === 'path') {
      g.d = el.getAttribute('d') || '';
      return g.d ? g : null;
    }
    if (tag === 'circle') {
      g.cx = numAttr(el, 'cx', 0);
      g.cy = numAttr(el, 'cy', 0);
      g.r = numAttr(el, 'r', 0);
      return g.r > 0 ? g : null;
    }
    if (tag === 'ellipse') {
      g.cx = numAttr(el, 'cx', 0);
      g.cy = numAttr(el, 'cy', 0);
      g.rx = numAttr(el, 'rx', 0);
      g.ry = numAttr(el, 'ry', 0);
      return (g.rx > 0 && g.ry > 0) ? g : null;
    }
    if (tag === 'rect') {
      g.x = numAttr(el, 'x', 0);
      g.y = numAttr(el, 'y', 0);
      g.w = numAttr(el, 'width', 0);
      g.h = numAttr(el, 'height', 0);
      g.rx = numAttr(el, 'rx', numAttr(el, 'ry', 0));
      return (g.w > 0 && g.h > 0) ? g : null;
    }
    if (tag === 'line') {
      g.x1 = numAttr(el, 'x1', 0);
      g.y1 = numAttr(el, 'y1', 0);
      g.x2 = numAttr(el, 'x2', 0);
      g.y2 = numAttr(el, 'y2', 0);
      return g;
    }
    if (tag === 'polyline' || tag === 'polygon') {
      g.points = pointsAttr(el);
      return g.points.length >= 4 ? g : null;
    }
    return null;
  }

  /* Works with both a Path2D and a 2D context: they share the path API. */
  function traceInto(target, g) {
    var i;
    switch (g.tag) {
      case 'circle':
        target.moveTo(g.cx + g.r, g.cy);
        target.arc(g.cx, g.cy, g.r, 0, TAU);
        target.closePath();
        break;
      case 'ellipse':
        target.moveTo(g.cx + g.rx, g.cy);
        target.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, TAU);
        target.closePath();
        break;
      case 'rect':
        if (g.rx > 0 && typeof target.roundRect === 'function') {
          try {
            target.roundRect(g.x, g.y, g.w, g.h, g.rx);
            break;
          } catch (e) { /* fall through to a square-cornered rect */ }
        }
        target.rect(g.x, g.y, g.w, g.h);
        break;
      case 'line':
        target.moveTo(g.x1, g.y1);
        target.lineTo(g.x2, g.y2);
        break;
      case 'polyline':
      case 'polygon':
        if (g.points.length < 4) break;
        target.moveTo(g.points[0], g.points[1]);
        for (i = 2; i + 1 < g.points.length; i += 2) {
          target.lineTo(g.points[i], g.points[i + 1]);
        }
        if (g.tag === 'polygon') target.closePath();
        break;
    }
  }

  /* Paints that would draw nothing (or cannot be resolved) are dropped. */
  function usablePaint(value) {
    if (!value) return null;
    var s = String(value).trim();
    if (!s || s === 'none' || s === 'transparent') return null;
    if (s === 'rgba(0, 0, 0, 0)') return null;
    if (s.indexOf('url(') === 0) return null;
    return s;
  }

  /* ----------------------------------------------------- inert controller */

  function emptyBlob() {
    try {
      return new Blob([], { type: 'video/webm' });
    } catch (e) {
      try { return new Blob([]); } catch (e2) { return null; }
    }
  }

  /* A controller that records nothing but still behaves: stop() resolves. */
  function inertController() {
    var settled = null;
    return {
      stop: function () {
        if (!settled) settled = Promise.resolve(emptyBlob());
        return settled;
      },
      cancel: function () {
        if (!settled) settled = Promise.resolve(emptyBlob());
      },
      get elapsed() { return 0; }
    };
  }

  /* ================================================================ start */

  function start(opts) {
    var options = opts || {};
    var sourceSvg = options.svg;

    /* Guard: nothing to record -> a controller that resolves an empty blob. */
    if (!sourceSvg || sourceSvg.nodeType !== 1 || typeof sourceSvg.cloneNode !== 'function') {
      return inertController();
    }

    var doc = sourceSvg.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return inertController();
    var win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    if (!win) return inertController();

    var W = toInt(options.width, 1280);
    var H = toInt(options.height, 960);
    var fps = Math.max(1, Math.min(60, toInt(options.fps, 30)));
    var background = normaliseBackground(options.background);

    /* Feature probe: without MediaRecorder or canvas capture there is nothing
       honest to do, but the API shape must still be respected. */
    if (typeof win.MediaRecorder !== 'function') return inertController();

    var canvas = doc.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    if (typeof canvas.captureStream !== 'function') return inertController();

    var ctx = null;
    try {
      ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
    } catch (e) {
      ctx = null;
    }
    if (!ctx) return inertController();

    /* Cached raster of the mirror's static content, blitted once per frame. */
    var baseCanvas = doc.createElement('canvas');
    baseCanvas.width = W;
    baseCanvas.height = H;
    var baseCtx = null;
    try {
      baseCtx = baseCanvas.getContext('2d');
    } catch (e) {
      baseCtx = null;
    }

    /* ------------------------------------------------------------ session */

    var session = {
      mode: 'advanced',
      fails: 0,
      frames: 0,
      timer: 0,
      stopped: false,
      cancelled: false,
      startedAt: 0,
      endedAt: 0,
      recording: false,
      recorder: null,
      stream: null,
      mime: '',
      chunks: [],
      baseImg: null,
      baseBitmap: null,
      baseBusy: false,
      mirror: null,
      mirrorHost: null,
      host: null,
      tracked: [],
      records: null,
      baseMatrices: null,
      error: null
    };

    try {
      session.records = typeof win.WeakMap === 'function' ? new win.WeakMap() : null;
    } catch (e) {
      session.records = null;
    }
    try {
      session.baseMatrices = typeof win.WeakMap === 'function' ? new win.WeakMap() : null;
    } catch (e) {
      session.baseMatrices = null;
    }

    var bgGradient = null;
    var simpleBusy = false;

    function now() {
      try {
        if (win.performance && typeof win.performance.now === 'function') {
          return win.performance.now();
        }
      } catch (e) { /* ignore */ }
      return Date.now();
    }

    function styleOf(el) {
      try {
        return win.getComputedStyle ? win.getComputedStyle(el) : null;
      } catch (e) {
        return null;
      }
    }

    function serialize(node) {
      var Serializer = win.XMLSerializer || (typeof XMLSerializer !== 'undefined' ? XMLSerializer : null);
      if (!Serializer) throw new Error('StickRecorder: XMLSerializer is unavailable');
      return new Serializer().serializeToString(node);
    }

    /* ----------------------------------------------------- transform read */

    function attrMatrix(el) {
      var raw = el.getAttribute ? el.getAttribute('transform') : null;
      if (!raw) return null;
      try {
        var list = el.transform && el.transform.baseVal;
        if (list && list.numberOfItems) {
          var consolidated = list.consolidate();
          if (consolidated && consolidated.matrix) {
            var m = consolidated.matrix;
            var out = { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
            return isFiniteMatrix(out) ? out : null;
          }
        }
      } catch (e) { /* fall back to the string parser */ }
      return parseTransformAttribute(raw);
    }

    function readViewBox() {
      var raw = sourceSvg.getAttribute ? sourceSvg.getAttribute('viewBox') : null;
      if (!raw) return null;
      var p = String(raw).trim().split(/[\s,]+/).map(parseFloat);
      if (p.length < 4 || !p.every(isFinite)) return null;
      if (!(p[2] > 0) || !(p[3] > 0)) return null;
      return { x: p[0], y: p[1], w: p[2], h: p[3] };
    }

    function readPreserveAspectRatio() {
      var raw = sourceSvg.getAttribute ? sourceSvg.getAttribute('preserveAspectRatio') : null;
      var align = 'xMidYMid';
      var slice = 'meet';
      if (raw) {
        var parts = String(raw).trim().split(/\s+/);
        var i = parts[0] === 'defer' ? 1 : 0;
        if (parts[i]) align = parts[i];
        if (parts[i + 1]) slice = parts[i + 1];
      }
      return { align: align, slice: slice };
    }

    function viewBoxMatrix(vb, viewportW, viewportH, par) {
      if (par.align === 'none') {
        var sx = viewportW / vb.w;
        var sy = viewportH / vb.h;
        return { a: sx, b: 0, c: 0, d: sy, e: -vb.x * sx, f: -vb.y * sy };
      }
      var s = par.slice === 'slice'
        ? Math.max(viewportW / vb.w, viewportH / vb.h)
        : Math.min(viewportW / vb.w, viewportH / vb.h);
      var dw = viewportW - vb.w * s;
      var dh = viewportH - vb.h * s;
      var ax = dw / 2;
      var ay = dh / 2;
      if (par.align.indexOf('xMin') === 0) ax = 0;
      else if (par.align.indexOf('xMax') === 0) ax = dw;
      if (par.align.indexOf('YMin') > 0) ay = 0;
      else if (par.align.indexOf('YMax') > 0) ay = dh;
      return { a: s, b: 0, c: 0, d: s, e: ax - vb.x * s, f: ay - vb.y * s };
    }

    /* SVG user space -> stage canvas pixels.
       The target viewport IS the video frame, exactly like the serialised base
       snapshot, so both go through the same viewBox/preserveAspectRatio maths
       and every procedurally drawn element lands precisely on top of its
       static counterpart.  Read every frame, so a camera zoom (changing
       viewBox) is picked up. */
    function viewMatrix() {
      var vb = readViewBox();
      if (vb) return viewBoxMatrix(vb, W, H, readPreserveAspectRatio());

      /* No viewBox: user units are viewport pixels, so scale the element box. */
      var rect;
      try {
        rect = sourceSvg.getBoundingClientRect();
      } catch (e) {
        rect = null;
      }
      var rw = rect ? rect.width : 0;
      var rh = rect ? rect.height : 0;
      if (!(rw > 0) || !(rh > 0)) {
        rw = sourceSvg.clientWidth || 0;
        rh = sourceSvg.clientHeight || 0;
      }
      if (!(rw > 0) || !(rh > 0)) {
        throw new Error('StickRecorder: the stage has no measurable size');
      }
      return scaleMatrix(W / rw, H / rh);
    }

    function originBox(el, cs) {
      /* Default transform-box for SVG in Chromium is view-box. */
      var box = cs.transformBox || 'view-box';
      if (box === 'fill-box' || box === 'stroke-box' || box === 'content-box' || box === 'border-box') {
        try {
          var b = el.getBBox();
          if (b && isFinite(b.width) && isFinite(b.height)) {
            return { x: b.x, y: b.y, w: b.width, h: b.height };
          }
        } catch (e) { /* not rendered yet */ }
        return null;
      }
      var vb = readViewBox();
      if (vb) return { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
      return { x: 0, y: 0, w: sourceSvg.clientWidth || W, h: sourceSvg.clientHeight || H };
    }

    /* Percentages resolve against the reference box; bare lengths are taken as
       absolute user coordinates, which is how this studio writes its origins
       (e.g. `transform-origin:12px 80px` on a swaying weed). */
    function originComponent(raw, boxStart, boxSize) {
      var s = String(raw == null ? '' : raw).trim();
      if (!s) return NaN;
      if (s === 'left' || s === 'top') return boxStart;
      if (s === 'center') return boxStart + boxSize / 2;
      if (s === 'right' || s === 'bottom') return boxStart + boxSize;
      if (s.charAt(s.length - 1) === '%') {
        var pct = parseFloat(s);
        return isFinite(pct) ? boxStart + (pct / 100) * boxSize : NaN;
      }
      var px = parseFloat(s);
      return isFinite(px) ? px : NaN;
    }

    function resolveOrigin(el, cs) {
      var raw = String(cs.transformOrigin || '').trim();
      if (!raw) return null;
      var parts = raw.split(/\s+/);
      var box = originBox(el, cs);
      if (!box) return null;
      var x = originComponent(parts[0], box.x, box.w);
      var y = originComponent(parts[1] || 'center', box.y, box.h);
      if (!isFinite(x) || !isFinite(y)) return null;
      return { x: x, y: y };
    }

    /* The element's own *current* animated transform (excluding its parent). */
    function ownMatrix(el, cs) {
      var m = parseMatrixString(cs.transform);
      if (!m) m = attrMatrix(el);
      if (!m || isIdentity(m) || !isFiniteMatrix(m)) return null;

      /* transform-origin only applies to the CSS transform property, and only
         matters for rotation/scale - a pure translation is origin-free. */
      var rotates = m.a !== 1 || m.b !== 0 || m.c !== 0 || m.d !== 1;
      var animatedByCss = !!(cs.animationName && cs.animationName !== 'none');
      if (rotates && animatedByCss) {
        var origin = resolveOrigin(el, cs);
        if (origin) {
          m = multiply(multiply(translate(origin.x, origin.y), m), translate(-origin.x, -origin.y));
        }
      }
      return m;
    }

    /* Composed transform of every ancestor between the stage <svg> and el. */
    function ancestorMatrix(el) {
      var chain = [];
      var parent = el.parentNode;
      while (parent && parent !== sourceSvg && parent.nodeType === 1) {
        chain.push(parent);
        parent = parent.parentNode;
      }
      var m = identity();
      for (var i = chain.length - 1; i >= 0; i--) {
        var node = chain[i];
        var cs = styleOf(node);
        if (!cs) continue;
        var own = ownMatrix(node, cs);
        if (own) m = multiply(m, own);
      }
      return m;
    }

    /* --------------------------------------------------------- draw cache */

    function buildRecord(el, cs) {
      var tag = String(el.tagName || '').toLowerCase();
      if (SKIP_TAGS[tag]) return null;

      var geom = buildGeometry(el, tag);
      if (!geom) return null;

      var rec = {
        geom: geom,
        path: null,
        fill: usablePaint(cs.fill),
        stroke: usablePaint(cs.stroke),
        lineWidth: parseFloat(cs.strokeWidth),
        fillOpacity: parseFloat(cs.fillOpacity),
        strokeOpacity: parseFloat(cs.strokeOpacity),
        lineCap: cs.strokeLinecap || '',
        lineJoin: cs.strokeLinejoin || '',
        dash: null
      };

      if (!isFinite(rec.lineWidth)) rec.lineWidth = 1;
      if (!isFinite(rec.fillOpacity)) rec.fillOpacity = 1;
      if (!isFinite(rec.strokeOpacity)) rec.strokeOpacity = 1;

      var dashRaw = cs.strokeDasharray;
      if (dashRaw && dashRaw !== 'none') {
        var dash = String(dashRaw).match(/-?\d*\.?\d+/g);
        if (dash && dash.length) {
          rec.dash = dash.map(parseFloat).filter(function (v) { return isFinite(v) && v >= 0; });
          if (!rec.dash.length) rec.dash = null;
        }
      }

      /* Paths are immutable for these elements, so pre-bake them once. */
      var Path2DImpl = win.Path2D;
      if (typeof Path2DImpl === 'function') {
        try {
          if (tag === 'path') {
            rec.path = new Path2DImpl(geom.d);
          } else {
            var p = new Path2DImpl();
            traceInto(p, geom);
            rec.path = p;
          }
        } catch (e) {
          rec.path = null;
        }
      }
      return rec;
    }

    function recordFor(el, cs) {
      var cache = session.records;
      if (cache) {
        var hit = cache.get(el);
        if (hit) return hit;
      }
      var rec = buildRecord(el, cs);
      if (rec && cache) cache.set(el, rec);
      return rec;
    }

    /* ------------------------------------------------------------- drawing */

    function paintBackground() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      try {
        if (!bgGradient) {
          bgGradient = ctx.createLinearGradient(0, 0, 0, H);
          for (var i = 0; i < background.length; i++) {
            var stop = background.length === 1 ? 0 : i / (background.length - 1);
            bgGradient.addColorStop(stop, background[i]);
          }
        }
        ctx.fillStyle = bgGradient;
      } catch (e) {
        /* An unusable colour must not stop the background from being painted. */
        bgGradient = null;
        try { ctx.fillStyle = background[0] || '#f4f1ea'; } catch (e2) { /* ignore */ }
      }
      ctx.fillRect(0, 0, W, H);
    }

    function drawShape(el, cs, m, alpha) {
      var rec = recordFor(el, cs);
      if (!rec) return;

      var hasFill = !!rec.fill;
      var hasStroke = !!rec.stroke && rec.lineWidth > 0;
      if (!hasFill && !hasStroke) return;

      ctx.save();
      try {
        ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);

        var path = rec.path;
        if (!path) {
          ctx.beginPath();
          traceInto(ctx, rec.geom);
        }

        if (hasFill) {
          ctx.globalAlpha = clampAlpha(alpha * rec.fillOpacity);
          ctx.fillStyle = rec.fill;
          if (path) ctx.fill(path); else ctx.fill();
        }

        if (hasStroke) {
          ctx.globalAlpha = clampAlpha(alpha * rec.strokeOpacity);
          ctx.strokeStyle = rec.stroke;
          ctx.lineWidth = rec.lineWidth;
          if (rec.lineCap) ctx.lineCap = rec.lineCap;
          if (rec.lineJoin) ctx.lineJoin = rec.lineJoin;
          if (rec.dash && typeof ctx.setLineDash === 'function') ctx.setLineDash(rec.dash);
          if (path) ctx.stroke(path); else ctx.stroke();
        }
      } catch (e) {
        /* one unhappy shape must not take the frame down */
      } finally {
        try { if (ctx.setLineDash) ctx.setLineDash([]); } catch (e) { /* ignore */ }
        ctx.restore();
      }
    }

    /* Draws an animated root and everything inside it, composing each child's
       own live transform as we descend. */
    function drawNode(el, m, alpha, depth) {
      if (!el || el.nodeType !== 1 || depth > MAX_DEPTH) return;

      var tag = String(el.tagName || '').toLowerCase();
      if (SKIP_TAGS[tag]) return;

      var cs = styleOf(el);
      if (!cs) return;

      var opacity = parseFloat(cs.opacity);
      if (!isFinite(opacity)) opacity = 1;
      var nextAlpha = alpha * opacity;
      if (nextAlpha <= 0.004) return;
      if (cs.display === 'none' || cs.visibility === 'hidden') return;

      var own = ownMatrix(el, cs);
      var full = own ? multiply(m, own) : m;

      if (tag === 'g' || tag === 'svg' || tag === 'a') {
        var kids = el.childNodes;
        for (var i = 0; i < kids.length; i++) {
          if (kids[i].nodeType === 1) drawNode(kids[i], full, nextAlpha, depth + 1);
        }
        return;
      }
      drawShape(el, cs, full, nextAlpha);
    }

    function drawAdvancedFrame() {
      var v = viewMatrix();
      paintBackground();

      if (session.baseBitmap) {
        try {
          ctx.drawImage(session.baseBitmap, 0, 0, W, H);
        } catch (e) {
          session.baseBitmap = null;
          session.baseImg = null;
        }
      }

      var list = session.tracked;
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        try {
          var m = multiply(v, item.base || identity());
          drawNode(item.el, m, 1, 0);
        } catch (e) {
          /* skip the element, keep the frame */
        }
      }
    }

    /* Old, reliable behaviour: clone + serialise the whole stage each frame. */
    function drawSimpleFrame() {
      if (simpleBusy || session.stopped) return;
      simpleBusy = true;

      var xml;
      try {
        var clone = sourceSvg.cloneNode(true);
        clone.setAttribute('xmlns', SVG_NS);
        clone.setAttribute('width', String(W));
        clone.setAttribute('height', String(H));
        xml = serialize(clone);
      } catch (e) {
        simpleBusy = false;
        return;
      }

      try {
        paintBackground();
      } catch (e) {
        simpleBusy = false;
        return;
      }

      var img = new win.Image();
      var done = false;
      var guard = setTimeout(function () { finish(); }, SIMPLE_FRAME_TIMEOUT_MS);

      function finish() {
        if (done) return;
        done = true;
        clearTimeout(guard);
        simpleBusy = false;
      }

      img.onload = function () {
        try {
          if (!session.stopped) ctx.drawImage(img, 0, 0, W, H);
        } catch (e) { /* tainted or broken image */ }
        finish();
      };
      img.onerror = function () { finish(); };

      try {
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      } catch (e) {
        finish();
      }
    }

    /* ----------------------------------------------------- mirror + base */

    function prepareMirror() {
      if (session.host) return;
      var host = doc.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.position = 'fixed';
      host.style.left = '-20000px';
      host.style.top = '0px';
      host.style.width = '320px';
      host.style.height = '240px';
      host.style.overflow = 'hidden';
      host.style.opacity = '0.01';
      host.style.pointerEvents = 'none';
      host.style.zIndex = '-1';

      var holder = doc.createElement('div');
      holder.style.position = 'absolute';
      holder.style.left = '0';
      holder.style.top = '0';
      holder.style.width = '100%';
      holder.style.height = '100%';

      host.appendChild(holder);
      (doc.body || doc.documentElement).appendChild(host);
      session.host = host;
      session.mirrorHost = holder;
    }

    function teardownMirror() {
      session.mirror = null;
      session.mirrorHost = null;
      var host = session.host;
      session.host = null;
      if (host && host.parentNode) host.parentNode.removeChild(host);
    }

    /* Live, attached clone.  Re-cloned with each base refresh so character
       poses in the static raster stay current.  Deliberately NOT display:none:
       a hidden-from-layout SVG never runs its CSS animations. */
    function syncMirror() {
      if (session.stopped || !session.mirrorHost) return;
      var clone = sourceSvg.cloneNode(true);
      clone.setAttribute('xmlns', SVG_NS);
      clone.setAttribute('width', '100%');
      clone.setAttribute('height', '100%');
      clone.style.width = '100%';
      clone.style.height = '100%';
      try { clone.removeAttribute('id'); } catch (e) { /* ignore */ }

      if (session.mirror && session.mirror.parentNode === session.mirrorHost) {
        session.mirrorHost.replaceChild(clone, session.mirror);
      } else {
        while (session.mirrorHost.firstChild) {
          session.mirrorHost.removeChild(session.mirrorHost.firstChild);
        }
        session.mirrorHost.appendChild(clone);
      }
      session.mirror = clone;
    }

    /* Mirror snapshot at video resolution, minus the elements we animate by
       hand (otherwise they would appear twice: once frozen, once moving). */
    function buildSnapshotXml() {
      var root = session.mirror ? session.mirror.cloneNode(true) : sourceSvg.cloneNode(true);
      root.setAttribute('xmlns', SVG_NS);
      root.setAttribute('width', String(W));
      root.setAttribute('height', String(H));
      /* The mirror is laid out with percentage sizing; inside a standalone
         image document a percentage root can fall back to 300x150 and distort
         the raster, so the snapshot is given absolute dimensions only. */
      try {
        root.style.width = '';
        root.style.height = '';
      } catch (e) { /* ignore */ }
      try {
        var animated = root.querySelectorAll(ANIMATED_SELECTOR);
        for (var i = animated.length - 1; i >= 0; i--) {
          var node = animated[i];
          if (node.parentNode) node.parentNode.removeChild(node);
        }
      } catch (e) { /* selectors unavailable: keep the snapshot as it is */ }
      return serialize(root);
    }

    function loadSvgImage(xml) {
      return new Promise(function (resolve) {
        var img = new win.Image();
        var url = null;
        var done = false;
        var timer = setTimeout(function () { finish(null); }, SNAPSHOT_TIMEOUT_MS);

        function finish(result) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (url) {
            var urlToFree = url;
            url = null;
            /* Revoking immediately after load is safe in Chromium; the small
               delay simply avoids any chance of racing the decoder. */
            setTimeout(function () {
              try { (win.URL || win.webkitURL).revokeObjectURL(urlToFree); } catch (e) { /* ignore */ }
            }, 1200);
          }
          resolve(result || null);
        }

        img.onload = function () { finish(img); };
        img.onerror = function () { finish(null); };

        try {
          var URLApi = win.URL || win.webkitURL;
          if (win.Blob && URLApi && typeof URLApi.createObjectURL === 'function') {
            url = URLApi.createObjectURL(new win.Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
            img.src = url;
          } else {
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
          }
        } catch (e) {
          finish(null);
        }
      });
    }

    /* Rasterise the decoded snapshot once into the base canvas, so every frame
       blits a plain bitmap instead of re-rasterising an SVG image. */
    function commitBase(img) {
      session.baseImg = img;
      if (!baseCtx) {
        session.baseBitmap = img;
        return;
      }
      try {
        baseCtx.clearRect(0, 0, W, H);
        baseCtx.drawImage(img, 0, 0, W, H);
        session.baseBitmap = baseCanvas;
      } catch (e) {
        session.baseBitmap = img;
      }
    }

    function refreshBase() {
      if (session.stopped || session.baseBusy) return Promise.resolve(false);
      session.baseBusy = true;

      var xml;
      try {
        syncMirror();
        /* The scene DOM can be rebuilt mid-recording (scene switch, layout),
           so the animated set is re-collected with every raster refresh. */
        rebuildTracked();
        xml = buildSnapshotXml();
      } catch (e) {
        session.baseBusy = false;
        return Promise.resolve(false);
      }

      return loadSvgImage(xml).then(function (img) {
        session.baseBusy = false;
        if (img && !session.stopped) commitBase(img);
        return !!img;
      }, function () {
        session.baseBusy = false;
        return false;
      });
    }

    /* --------------------------------------------------------- tracked set */

    function rebuildTracked() {
      if (session.stopped) return;
      var nodes = [];
      try {
        nodes = sourceSvg.querySelectorAll(ANIMATED_SELECTOR);
      } catch (e) {
        nodes = [];
      }

      var roots = [];
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var parent = node.parentNode;
        var nested = false;
        while (parent && parent !== sourceSvg) {
          if (parent.nodeType === 1) {
            var matches = parent.matches || parent.msMatchesSelector || parent.webkitMatchesSelector;
            if (matches) {
              try {
                if (matches.call(parent, ANIMATED_SELECTOR)) { nested = true; break; }
              } catch (e) { /* ignore */ }
            }
          }
          parent = parent.parentNode;
        }
        if (!nested) roots.push(node);
      }

      var tracked = [];
      var cache = session.baseMatrices;
      for (var j = 0; j < roots.length; j++) {
        var el = roots[j];
        var base = cache ? cache.get(el) : null;
        if (!base) {
          try {
            base = ancestorMatrix(el);
          } catch (e) {
            base = identity();
          }
          if (cache) cache.set(el, base);
        }
        tracked.push({ el: el, base: base });
      }
      session.tracked = tracked;
    }

    /* ----------------------------------------------------------- fallback */

    function fallbackToSimple(err) {
      if (session.mode === 'simple') return;
      session.mode = 'simple';
      if (!session.error) session.error = err || null;
      session.tracked = [];
      session.baseImg = null;
      session.baseBitmap = null;
      session.baseBusy = false;
      teardownMirror();
      try {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[StickRecorder] falling back to per-frame snapshots:', err && err.message ? err.message : err);
        }
      } catch (e) { /* ignore */ }
    }

    /* ------------------------------------------------------------ recorder */

    function pickMime() {
      var MR = win.MediaRecorder;
      for (var i = 0; i < MIME_TYPES.length; i++) {
        try {
          if (MR.isTypeSupported && MR.isTypeSupported(MIME_TYPES[i])) return MIME_TYPES[i];
        } catch (e) { /* try the next candidate */ }
      }
      return 'video/webm';
    }

    function detachTracks() {
      var stream = session.stream;
      session.stream = null;
      if (!stream) return;
      try {
        var tracks = typeof stream.getTracks === 'function' ? stream.getTracks() : [];
        for (var i = 0; i < tracks.length; i++) {
          try { tracks[i].stop(); } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
    }

    function startRecorder() {
      if (session.recorder || session.stopped) return;
      try {
        session.stream = canvas.captureStream(fps);
        var rec = new win.MediaRecorder(session.stream, {
          mimeType: session.mime,
          videoBitsPerSecond: VIDEO_BITS_PER_SECOND
        });
        rec.ondataavailable = function (ev) {
          if (ev && ev.data && ev.data.size) session.chunks.push(ev.data);
        };
        rec.onerror = function (ev) {
          session.error = (ev && ev.error) || new Error('StickRecorder: MediaRecorder error');
        };
        session.recorder = rec;
        rec.start(1000);
        session.recording = true;
        session.startedAt = now();
      } catch (e) {
        session.error = e;
        session.recorder = null;
        session.recording = false;
        detachTracks();
      }
    }

    /* ---------------------------------------------------------------- loop */

    function clearLoop() {
      if (session.timer) {
        clearTimeout(session.timer);
        session.timer = 0;
      }
    }

    function startLoop() {
      var frameMs = 1000 / fps;

      function tick() {
        session.timer = 0;
        if (session.stopped) return;

        var started = now();
        try {
          if (session.mode === 'advanced') {
            try {
              drawAdvancedFrame();
              session.fails = 0;
            } catch (e) {
              session.fails++;
              if (session.fails >= MAX_ADVANCED_FAILURES) fallbackToSimple(e);
            }
          } else {
            drawSimpleFrame();
          }
        } catch (e) {
          /* the loop must never die mid-recording */
        }

        session.frames++;
        if (session.mode === 'advanced' && session.frames % BASE_REFRESH_FRAMES === 0) {
          /* fire and forget: the previous raster stays on screen until the new
             one decodes, so a slow refresh can never stall the frame loop */
          try { refreshBase(); } catch (e) { /* ignore */ }
        }

        var spent = now() - started;
        var wait = Math.max(0, frameMs - spent);
        if (!session.stopped) session.timer = setTimeout(tick, wait);
      }

      tick();
    }

    /* --------------------------------------------------------------- setup */

    async function setup() {
      try {
        if (session.stopped) return;

        try {
          prepareMirror();
          syncMirror();
          rebuildTracked();
          /* Build the first raster and let it decode before the recorder
             starts, so the video never opens on a half-drawn stage.  Bounded
             so a stuck decode cannot hold the recording hostage. */
          await Promise.race([refreshBase(), delay(700)]);
          if (session.stopped) return;
          drawAdvancedFrame();          /* probe: surfaces a broken path early */
        } catch (e) {
          if (session.mode === 'advanced') fallbackToSimple(e);
        }

        if (session.stopped) return;
        startRecorder();
        if (session.recorder) startLoop();
      } catch (e) {
        if (!session.error) session.error = e;
      } finally {
        resolveReady();
      }
    }

    /* -------------------------------------------------------------- stop */

    var ready = null;
    var resolveReady = null;
    ready = new Promise(function (resolve) { resolveReady = resolve; });

    var stopPromise = null;
    var finalizePromise = null;

    function cleanup() {
      try { clearLoop(); } catch (e) { /* ignore */ }
      try { teardownMirror(); } catch (e) { /* ignore */ }
      try { detachTracks(); } catch (e) { /* ignore */ }

      session.tracked = [];
      session.baseImg = null;
      session.baseBitmap = null;
      session.baseBusy = false;

      try {
        session.records = typeof win.WeakMap === 'function' ? new win.WeakMap() : null;
      } catch (e) {
        session.records = null;
      }
      try {
        session.baseMatrices = typeof win.WeakMap === 'function' ? new win.WeakMap() : null;
      } catch (e) {
        session.baseMatrices = null;
      }

      var rec = session.recorder;
      session.recorder = null;
      session.recording = false;
      if (rec) {
        try {
          rec.ondataavailable = null;
          rec.onstop = null;
          rec.onerror = null;
        } catch (e) { /* ignore */ }
      }
    }

    function finalize() {
      if (finalizePromise) return finalizePromise;

      finalizePromise = new Promise(function (resolve) {
        var settled = false;
        var watchdog = setTimeout(complete, STOP_TIMEOUT_MS);

        /* Every path through here resolves.  A throwing cleanup must not turn
           a finished recording into a rejected promise. */
        function complete() {
          if (settled) return;
          settled = true;
          try { clearTimeout(watchdog); } catch (e) { /* ignore */ }
          try { cleanup(); } catch (e) { /* ignore */ }

          var blob = null;
          try {
            blob = new win.Blob(session.cancelled ? [] : session.chunks, { type: 'video/webm' });
          } catch (e) {
            blob = null;
          }
          try { session.chunks = []; } catch (e) { /* ignore */ }
          resolve(blob || emptyBlob());
        }

        var rec = session.recorder;
        if (!rec || rec.state === 'inactive' || typeof rec.stop !== 'function') {
          complete();
          return;
        }
        try {
          rec.onstop = complete;
          rec.onerror = complete;
        } catch (e) { /* ignore */ }

        try {
          rec.stop();
        } catch (e) {
          complete();
        }
      });

      return finalizePromise;
    }

    function stop() {
      if (stopPromise) return stopPromise;

      session.stopped = true;
      session.endedAt = now();
      clearLoop();

      stopPromise = Promise.race([ready, delay(SETUP_TIMEOUT_MS)])
        .then(function () { return delay(90); })   /* let the last frames land */
        .then(function () { return finalize(); }, function () { return finalize(); })
        .catch(function () { return emptyBlob(); }); /* stop() always resolves */

      return stopPromise;
    }

    function cancel() {
      session.cancelled = true;
      session.chunks = [];
      clearLoop();
      stop();   /* release DOM + stream; the resulting blob is discarded */
    }

    var controller = {
      stop: stop,
      cancel: cancel,
      get elapsed() {
        if (!session.startedAt) return 0;
        var end = session.stopped ? (session.endedAt || now()) : now();
        return Math.max(0, end - session.startedAt);
      }
    };

    /* --------------------------------------------------------------- boot */

    session.mime = pickMime();
    setup().catch(function (e) {
      if (!session.error) session.error = e;
      resolveReady();
    });

    return controller;
  }

  /* ------------------------------------------------------------- exports */

  if (typeof window !== 'undefined' && window) {
    window.StickRecorder = { start: start };
  }
}());
