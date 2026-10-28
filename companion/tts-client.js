/* stick companion — speech client.
 *
 * Talks to the local Python bridge (voice/server.py) over a single streaming
 * POST. Frames are [kind:1][length:uint32be][payload]; 'J' is JSON, 'A' is
 * 16-bit little-endian PCM at 24 kHz mono. Audio is scheduled on the Web Audio
 * clock (never on network arrival time), and the jaw is driven by a real
 * amplitude envelope measured from that same audio.
 *
 * While one segment is being spoken the next two are already requested in the
 * background (see the prefetch queue below), so a multi-person performance has
 * no dead air between speakers.
 */
(function () {
  'use strict';
  const STICK = window.STICK;

  class TTSClient {
    constructor(opts) {
      this.base = (opts.base || 'http://127.0.0.1:8765').replace(/\/$/, '');
      this.rig = opts.rig || null;
      this.rigFor = opts.rigFor || (() => this.rig);
      this.onSegment = opts.onSegment || null;
      this.onStatus = opts.onStatus || (() => {});
      this.onMetrics = opts.onMetrics || (() => {});
      this.onLog = opts.onLog || (() => {});
      this.health = null;
      this.activeSpeaker = null;
      this.pauseGap = 0;
      this._pumpedRig = null;
      this.cues = [];
      this.pendingQueue = [];
      this._segEvents = 0;
      this._fillSeg = null;
      this._fillParts = [];
      this._firedSegs = new Set();          // { at, ev } applied on the audio clock
      this.pendingSeg = null;  // segment waiting for its first audio chunk
      this.pendingQueue = [];  // segments whose audio has not started yet
      this.capture = [];       // decoded chunks for replay
      this.segVoices = new Map();  // segment index -> the voice that segment is spoken in
      this.voiceLog = [];          // { index, speaker_id, voice } for every segment sent
      this.prefetchAhead = 0;      // lookahead disabled (see the segment handler)
      this._segments = null;       // segments of the current utterance, once known
      this._optsBase = {};         // speak() options minus text/segments, for lookahead
      this._pf = new Map();        // segment index -> prefetch entry (own request)
      this._pipelineFrom = null;   // first index played out of the prefetch queue
      this._pipe = null;           // scheduling loop of the prefetch queue
      this.activeSegIndex = null;
      this._audioBytes = 0;
      this.onCached = opts.onCached || (() => {});
      this.ctx = null;
      this.gain = null;
      this.analyser = null;
      this.sources = new Set();
      this.generation = 0;
      this.controller = null;
      this.playing = false;
      this.muted = false;
      this.cursor = 0;
      this.metrics = {};
      this._buf = new Uint8Array(0);
      this._rms = new Uint8Array(1024);
    }

    /* ------------------------------------------------------------- setup */
    _ensureAudio() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.55;
        this.gain = this.ctx.createGain();
        this.gain.gain.value = this.muted ? 0 : 1;
        this.analyser.connect(this.gain);
        this.gain.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    async probe() {
      try {
        const res = await fetch(this.base + '/health', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        this.health = await res.json();
      } catch (err) {
        this.health = { ok: false, provider: 'offline', error: String(err) };
      }
      this.onStatus(this.health);
      return this.health;
    }

    get canSpeak() {
      return !!(this.health && this.health.provider && this.health.provider !== 'offline'
        && this.health.provider !== 'unconfigured');
    }

    setMuted(m) {
      this.muted = !!m;
      if (this.gain) this.gain.gain.value = this.muted ? 0 : 1;
      return this.muted;
    }

    /* ------------------------------------------------------------- speak */
    async speak(opts) {
      this.stop('superseded');
      // A promise that settles when this utterance finishes playing. Sequential
      // callers (the Action director) await it so one beat never truncates the
      // previous beat's audio.
      let resolveDone;
      this.done = new Promise(res => { resolveDone = res; });
      this._resolveDone = resolveDone;
      this.lastError = null;
      // Normalise the request first: every segment keeps its own voice and
      // speaker_id, and segVoices/voiceLog are rebuilt for this utterance.
      const request = this._prepare(opts || {});
      const gen = ++this.generation;
      const ctx = this._ensureAudio();
      const t0 = performance.now();
      this.playing = true;
      this.cursor = 0;
      this.cues = [];
      this.pendingQueue = [];
      this._segEvents = 0;
      this._fillSeg = null;
      this._fillParts = [];
      this._streamEnded = false;
      this._firedSegs = new Set();
      this.pendingSeg = null;
      this.activeSegIndex = null;
      this.capture = [];
      this.activeSpeaker = null;
      this._buf = new Uint8Array(0);
      this._audioBytes = 0;
      this.metrics = { requestedAt: t0, firstFrameMs: null, firstAudioMs: null, firstPlayedMs: null, endedMs: null, audioSeconds: 0 };
      this.controller = new AbortController();
      this.onMetrics(this.metrics);
      if (this.rig) this.rig.apply({ type: 'speech', value: 'speaking' });
      // Warm the lookahead queue before the first byte arrives: while segment 0
      // is being spoken, the next one (and one more) is already being generated.
      if (this._segments) this._prefetchAround(0, gen);

      let res;
      try {
        res = await fetch(this.base + '/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: this.controller.signal,
        });
      } catch (err) {
        if (gen === this.generation) this._fail(err);
        return;
      }
      if (!res.ok) {
        let detail = 'HTTP ' + res.status;
        try {
          const j = await res.json();
          detail = j.error || detail;
          if (j.hint) detail += ' — ' + j.hint;
        } catch (e) { /* not json */ }
        if (gen === this.generation) this._fail(new Error(detail));
        return;
      }
      this._mark('firstFrameMs', t0);
      this.onStatus({ ...(this.health || {}), speaking: true });

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let handedOff = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (gen !== this.generation) { try { reader.cancel(); } catch (e) {} return; }
          if (done) break;
          this._buf = concat(this._buf, value);
          for (;;) {
            // the prefetch queue took over this utterance — drop whatever this
            // stream still had buffered so no line is played twice
            if (this._pipelineFrom != null) { handedOff = true; break; }
            if (this._buf.length < 5) break;
            const len = new DataView(this._buf.buffer, this._buf.byteOffset + 1, 4).getUint32(0);
            if (this._buf.length < 5 + len) break;
            const kind = this._buf[0];
            const payload = this._buf.slice(5, 5 + len);
            this._buf = this._buf.slice(5 + len);
            if (kind === 0x4a) this._event(JSON.parse(dec.decode(payload)), gen, t0);
            else if (kind === 0x41) this._audio(payload, gen, t0);
          }
          if (handedOff) break;
        }
      } catch (err) {
        if (gen === this.generation && err.name !== 'AbortError') this._fail(err);
      }
      if (handedOff) { try { reader.cancel(); } catch (e) { /* already closed */ } }
      this._streamEnded = true;   // server finished sending
      // the final segment has no following event, so flush it at end of stream
      if (gen === this.generation) this._flushFill(gen);
      // when the prefetch queue is driving playback, this utterance is only
      // "sent" once the queue has scheduled every remaining segment
      if (this._pipe && gen === this.generation) {
        try { await this._pipe; } catch (err) { /* the queue reports its own errors */ }
      }
    }

    _mark(key, t0) {
      if (this.metrics[key] == null) {
        this.metrics[key] = Math.round(performance.now() - t0);
        this.onMetrics(this.metrics);
      }
    }

    _event(ev, gen, t0) {
      if (gen !== this.generation) return;
      switch (ev.type) {
        case 'start':
          this.onStatus({ ...(this.health || {}), speaking: true, voice: ev.voice, provider: ev.provider });
          (ev.warnings || []).forEach(w => this.onLog({ type: 'notice', message: w }));
          // Text mode: the plan arrives here, so the lookahead queue can start
          // working on the segments after this one straight away.
          if (!this._segments && Array.isArray(ev.segments) && ev.segments.length) {
            this._segments = ev.segments.map(seg => Object.assign({}, seg));
            this.segVoices = new Map();
            this.voiceLog = [];
            this._segments.forEach((seg, i) => {
              const voice = seg.voice || ev.voice || null;
              this.segVoices.set(i, voice);
              this._logVoice(i, seg.speaker_id, voice);
            });
            this._prefetchAround(0, gen);
          }
          break;
        case 'segment': {
          // Do not switch the character yet: the audio for this segment is
          // only *arriving* now. The cue is applied when the audio clock
          // reaches its scheduled start (see pump()).
          const seg = Object.assign({}, ev);
          // Never let a voice-less event fall back to the global default: that
          // is how one character ends up speaking the other's lines.
          if (!seg.voice) seg.voice = this.segVoices.get(seg.index) || null;
          if (seg.speaker_id == null && this._segments && this._segments[seg.index]) {
            seg.speaker_id = this._segments[seg.index].speaker_id != null ? this._segments[seg.index].speaker_id : null;
          }
          // Playback is driven purely by the primary stream. The lookahead
          // queue used to "take over" here and abort that stream, which cut
          // every performance off after the first segment. It is disabled:
          // correctness first, and the primary stream is already gapless.
          this._prefetchAround(seg.index, gen);
          this.pauseGap = Math.max(0, (seg.pause_after_ms || 0) / 1000);
          // Queue it. The cue is raised in _audio() at the exact audio-clock
          // time this segment starts, which is what keeps the action and the
          // voice together. A single slot used to be overwritten when two
          // segment events arrived back to back, losing every later cue.
          // The previous segment's audio is now complete: schedule it before
          // starting to fill the next one.
          this._flushFill(gen);
          // Assign straight away if nothing is waiting; otherwise queue it.
          // Pushing unconditionally duplicated the segment that became pending.
          if (!this.pendingSeg) {
            this.pendingSeg = seg;
          } else {
            this.pendingQueue.push(seg);
            this._segEvents = (this._segEvents || 0) + 1;
          }
          this.onLog({ type: 'segment', message: `segment ${seg.index + 1}: ${seg.emotion}${seg.gesture ? ' + ' + seg.gesture : ''} — "${seg.text}"` });
          break;
        }
        case 'notice':
          this.onLog({ type: 'notice', message: ev.message });
          break;
        case 'error':
          this._fail(new Error(ev.message));
          break;
        case 'end':
          // the plan finished streaming on its own: nothing left to look ahead to
          for (const entry of this._pf.values()) {
            if (!entry.started) { try { entry.controller.abort(); } catch (err) { /* ignore */ } }
          }
          this._pf.clear();
          this.metrics.audioSeconds = ev.seconds;
          this.metrics.endedMs = Math.round(performance.now() - t0);
          this.onMetrics(this.metrics);
          this.onLog({ type: 'end', message: `audio ${ev.seconds}s · server ${ev.totalMs}ms` });
          break;
        default:
          break;
      }
    }

    // Schedule everything accumulated for one segment as a single buffer, then
    // raise exactly one cue at its audio start time.
    _flushFill(gen) {
      const seg = this._fillSeg;
      const parts = this._fillParts || [];
      this._fillSeg = null;
      this._fillParts = [];
      if (!seg || !parts.length) return;
      if (gen !== this.generation) return;
      const ctx = this.ctx;
      if (!ctx) return;
      try {
        const n = parts.reduce((a, c) => a + c.length, 0);
        const samples = new Float32Array(n);
        let o = 0;
        for (const c of parts) { samples.set(c, o); o += c.length; }
        const buf = ctx.createBuffer(1, n, 24000);
        buf.getChannelData(0).set(samples);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.analyser);
        const start = Math.max(this.cursor + this.pauseGap, ctx.currentTime + 0.04);
        this.pauseGap = 0;
        if (!this.cursor) this.metrics.firstPlayedMs = Math.round(performance.now() - this._fillT0 + (start - ctx.currentTime) * 1000);
        this.cursor = start + buf.duration;
        src.start(start);
        this.sources.add(src);
        src.onended = () => this.sources.delete(src);
        this.cues.push({ at: start, ev: seg });
        this.cues.sort((a, b) => a.at - b.at);
        this.activeSegIndex = seg.index;
        let cap = this.capture.find(c => c.ev.index === seg.index);
        if (!cap) { cap = { ev: seg, chunks: [] }; this.capture.push(cap); }
        cap.chunks.push(samples);
        this._mark('firstAudioMs', this._fillT0 || 0);
        if (this.metrics.firstPlayedMs != null) this.onMetrics(this.metrics);
      } catch (err) {
        this.onLog({ type: 'notice', message: 'audio schedule error: ' + (err.message || err) });
      }
    }

    _audio(bytes, gen, t0, from) {
      if (gen !== this.generation) return;
      // Once the prefetch queue drives playback, a frame still in flight on the
      // original stream would play a line that is already queued again.
      if (this._pipelineFrom != null && from !== 'pipe') return;
      const ctx = this.ctx;
      const n = Math.floor(bytes.byteLength / 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
      const ch = new Float32Array(n);
      for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;

      // Accumulate the audio for ONE segment instead of scheduling every chunk.
      // Segment events arrive AHEAD of their audio, so per-chunk scheduling
      // attached every later cue to the first line's chunks and the whole
      // performance fired during segment 1.
      if (!this._fillSeg && this.pendingSeg) {
        this._fillSeg = this.pendingSeg;
        this.pendingSeg = null;
      }
      this._fillParts.push(ch);
      this._fillT0 = t0;
      this._audioBytes += bytes.byteLength;
      return;
      // this chunk belongs to the pending segment: register the visual cue at
      // the exact time the segment's audio begins, and keep the samples for replay
      // Advance to the next segment only for a segment event we have not yet
      // cued, so each line gets exactly one cue at its own audio start time.
      if (!this.pendingSeg && this.pendingQueue.length && (this._segEvents || 0) > 0) {
        this.pendingSeg = this.pendingQueue.shift();
        this._segEvents = Math.max(0, (this._segEvents || 0) - 1);
      }
      if (this.pendingSeg) {
        const cueEv = this.pendingSeg;
        this.cues.push({ at: start, ev: cueEv });
        this.cues.sort((a, b) => a.at - b.at);
        this.activeSegIndex = cueEv.index;
        this.pendingSeg = null;
      }
      if (this.activeSegIndex != null) {
        let seg = this.capture.find(c => c.ev.index === this.activeSegIndex);
        if (!seg) { seg = { ev: this.cues.find(c => c.ev.index === this.activeSegIndex).ev, chunks: [] }; this.capture.push(seg); }
        seg.chunks.push(ch);
      }
      this._mark('firstAudioMs', t0);
      if (this.metrics.firstPlayedMs != null) this.onMetrics(this.metrics);
    }

    /* ----------------------------------------------------------- request */
    /* Work out what will be spoken and which voice/speaker owns each segment.
     * Returns the body of the primary request: every segment keeps its own
     * voice and speaker_id, so a two-person room never shares one voice. */
    _prepare(opts) {
      const request = Object.assign({}, opts);
      const base = Object.assign({}, opts);
      delete base.segments;
      delete base.text;
      this._optsBase = base;
      this._segments = null;
      this.segVoices = new Map();
      this.voiceLog = [];
      if (!Array.isArray(request.segments) || !request.segments.length) return request;
      const segs = request.segments.map((raw, index) => {
        const seg = Object.assign({}, raw);
        if (!seg.voice && request.voice) seg.voice = request.voice;
        if (seg.speaker_id == null && request.speaker_id != null) seg.speaker_id = request.speaker_id;
        this.segVoices.set(index, seg.voice || null);
        return seg;
      });
      request.segments = segs;
      this._segments = segs;
      segs.forEach((seg, index) => this._logVoice(index, seg.speaker_id, seg.voice));
      return request;
    }

    _logVoice(index, speakerId, voice) {
      this.voiceLog.push({ index, speaker_id: speakerId == null ? null : speakerId, voice: voice || null });
    }

    /* ---------------------------------------------------- prefetch queue */
    /* A segment is "ahead" when its index is past the one being spoken. Only
     * `prefetchAhead` of them may exist at a time; each has its own request and
     * its own frame parser, and never touches this.cursor or the live sources.
     * Their PCM is handed to _audio() when its turn comes, so cue timing,
     * activeSegIndex and capture stay exactly as they are for streamed audio. */
    _prefetchAround(index, gen) {
      if (!this._segments || !this._segments.length) return;
      // anything at or behind the segment being spoken is no longer useful
      for (const [key, entry] of this._pf) {
        if (key <= index && !entry.started) {
          try { entry.controller.abort(); } catch (err) { /* already gone */ }
          this._pf.delete(key);
        }
      }
      for (let k = 1; k <= this.prefetchAhead; k++) this._pfEntry(index + k, gen);
    }

    _pfEntry(index, gen) {
      if (gen !== this.generation || !this._segments) return null;
      if (index < 0 || index >= this._segments.length) return null;
      let entry = this._pf.get(index);
      if (!entry) {
        this._prefetchSegment(this._segments[index], index, gen);
        entry = this._pf.get(index);
      }
      return entry || null;
    }

    /* Buffered fetch of one segment: resolves with the entry whose `chunks`
     * hold the raw s16le frames. Stored in this._pf keyed by segment index. */
    _prefetchSegment(seg, index, gen) {
      const entry = {
        index, seg, ev: null, chunks: [], complete: false, error: null,
        consumed: 0, started: false, controller: new AbortController(), waiters: [],
      };
      this._pf.set(index, entry);
      entry.promise = this._fetchSegment(entry, gen)
        .catch(err => { entry.error = err || new Error('segment failed'); })
        .then(() => { entry.complete = true; this._pfWake(entry); return entry; });
      return entry.promise;
    }

    async _fetchSegment(entry, gen) {
      const body = Object.assign({}, this._optsBase);
      // one segment per request — with its own voice and speaker_id intact
      body.segments = [entry.seg];
      const res = await fetch(this.base + '/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: entry.controller.signal,
      });
      if (!res.ok) {
        let detail = 'HTTP ' + res.status;
        try {
          const j = await res.json();
          detail = j.error || detail;
        } catch (err) { /* not json */ }
        throw new Error(detail);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = new Uint8Array(0);
      for (;;) {
        const { value, done } = await reader.read();
        if (gen !== this.generation) {
          try { reader.cancel(); } catch (err) { /* ignore */ }
          throw new Error('cancelled');
        }
        if (done) break;
        buf = concat(buf, value);
        for (;;) {
          if (buf.length < 5) break;
          const len = new DataView(buf.buffer, buf.byteOffset + 1, 4).getUint32(0);
          if (buf.length < 5 + len) break;
          const kind = buf[0];
          const payload = buf.slice(5, 5 + len);
          buf = buf.slice(5 + len);
          if (kind === 0x4a) {
            const ev = JSON.parse(dec.decode(payload));
            if (ev.type === 'error') throw new Error(ev.message || 'speech failed');
            if (ev.type === 'segment') this._pfEvent(entry, ev);
          } else if (kind === 0x41) {
            entry.chunks.push(payload);
            this._pfWake(entry);
          }
        }
      }
      this._pfWake(entry);
    }

    _pfEvent(entry, ev) {
      const seg = entry.seg || {};
      const voice = ev.voice || seg.voice || this.segVoices.get(entry.index) || null;
      const speaker = ev.speaker_id != null ? ev.speaker_id : (seg.speaker_id != null ? seg.speaker_id : null);
      entry.ev = Object.assign({}, ev, {
        index: entry.index,                 // the server numbers a one-segment
        speaker_id: speaker,                // plan from 0; keep the real index
        voice,
        pause_after_ms: ev.pause_after_ms != null ? ev.pause_after_ms : (seg.pause_after_ms || 0),
      });
    }

    _pfWake(entry) {
      const waiters = entry.waiters;
      entry.waiters = [];
      for (let i = 0; i < waiters.length; i++) waiters[i]();
    }

    _pfWait(entry) {
      return new Promise(res => entry.waiters.push(res));
    }

    /* Hand a buffered segment to the normal scheduling path, chunk by chunk, so
     * cues / activeSegIndex / capture behave exactly like streamed audio. */
    async _playEntry(entry, gen, t0) {
      for (;;) {
        if (gen !== this.generation) return false;
        if (entry.consumed < entry.chunks.length) {
          const bytes = entry.chunks[entry.consumed++];
          if (!entry.started) {
            entry.started = true;
            const seg = this._segments ? this._segments[entry.index] : null;
            const ev = entry.ev || Object.assign({}, seg || {}, { index: entry.index });
            this.pendingSeg = ev;
            this.pauseGap = Math.max(0, (ev.pause_after_ms || 0) / 1000);
          }
          this._audio(bytes, gen, t0, 'pipe');
          continue;
        }
        if (entry.error) {
          if (gen === this.generation) this._fail(entry.error);
          return false;
        }
        if (entry.complete) {
          entry.chunks = [];
          return true;
        }
        await this._pfWait(entry);
      }
    }

    /* Switch playback over to the queue at `ev.index` and keep it fed, at most
     * `prefetchAhead` segments ahead of whatever is being spoken. */
    _takeOver(ev, gen, t0) {
      if (gen !== this.generation || !this.playing) return false;
      if (this._pipelineFrom != null) return true;
      // segment 0 is already streaming; only a buffered later segment can win
      if (!this._segments || ev.index < 1) return false;
      const entry = this._pf.get(ev.index);
      if (!entry || !entry.complete || entry.error) return false;
      this._pipelineFrom = ev.index;
      // the original stream would re-synthesise every remaining segment: stop it
      if (this.controller) { try { this.controller.abort(); } catch (err) { /* ignore */ } }
      this._pipe = this._runPipeline(gen, t0);
      return true;
    }

    async _runPipeline(gen, t0) {
      const segs = this._segments;
      if (!segs) return;
      for (let i = this._pipelineFrom; i < segs.length; i++) {
        if (gen !== this.generation) return;
        const entry = this._pfEntry(i, gen);
        if (!entry) return;
        // keep the queue warm: at most `prefetchAhead` segments ahead
        for (let k = 1; k <= this.prefetchAhead; k++) this._pfEntry(i + k, gen);
        const ok = await this._playEntry(entry, gen, t0);
        if (!ok) return;
        this._pf.delete(i);
      }
      if (gen !== this.generation) return;
      this.metrics.audioSeconds = Math.round(this._audioBytes / 48) / 1000;
      this.metrics.endedMs = Math.round(performance.now() - t0);
      this.onMetrics(this.metrics);
      this.onLog({ type: 'end', message: `audio ${this.metrics.audioSeconds}s · ${segs.length} segments queued` });
    }

    _fail(err) {
      this.lastError = err;
      this.playing = false;
      this._setLevel(0);
      this.onLog({ type: 'error', message: err.message || String(err) });
      this.onStatus({ ...(this.health || {}), speaking: false, error: err.message || String(err) });
    }

    _setLevel(v) {
      const rig = this.rigFor(this.activeSpeaker);
      if (rig) rig.setAudioLevel(v);
    }

    stop(reason) {
      this.generation++;
      // the lookahead queue belongs to the utterance being cancelled
      this._pipelineFrom = null;
      this._pipe = null;
      for (const entry of this._pf.values()) {
        try { entry.controller.abort(); } catch (err) { /* ignore */ }
        this._pfWake(entry);
      }
      this._pf.clear();
      // settle any waiter so a sequencer never hangs on a cancelled line
      if (this._resolveDone) { const r = this._resolveDone; this._resolveDone = null; r(); }
      if (this.controller) {
        try { this.controller.abort(); } catch (e) { /* ignore */ }
        this.controller = null;
      }
      for (const s of this.sources) { try { s.stop(); } catch (e) { /* ignore */ } }
      this.sources.clear();
      this.playing = false;
      this.cursor = 0;
      this.pauseGap = 0;
      const rig = this.rigFor(this.activeSpeaker);
      if (rig) {
        rig.setAudioLevel(0);
        rig.apply({ type: 'speech', value: 'stopped' });
      }
      if (reason && reason !== 'superseded') this.onLog({ type: 'cancelled', message: reason });
      this.onStatus({ ...(this.health || {}), speaking: false });
    }

    /* Called from the render loop: real amplitude -> jaw of the speaker. */
    pump() {
      if (!this.playing || !this.analyser || !this.ctx) return 0;
      const now = this.ctx.currentTime;
      while (this.cues.length && this.cues[0].at <= now + 0.03) {
        const cue = this.cues.shift();
        this.activeSpeaker = cue.ev.speaker_id || null;
        // The 'segment' handler already fired this cue when its audio arrived;
        // only fire here if it somehow did not.
        this._firedSegs = this._firedSegs || new Set();
        const idx = cue.ev.index;
        if (idx == null || !this._firedSegs.has(idx)) {
          if (idx != null) this._firedSegs.add(idx);
          if (this.onSegment) this.onSegment(cue.ev);
        }
      }
      const data = this._rms;
      this.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(1, rms * 3.6);
      const rig = this.rigFor(this.activeSpeaker);
      if (this._pumpedRig && this._pumpedRig !== rig) this._pumpedRig.setAudioLevel(0);
      if (rig) rig.setAudioLevel(level);
      this._pumpedRig = rig;
      if (this._streamEnded && this.cursor && this.ctx.currentTime > this.cursor + 0.35) {
        this.playing = false;
        this._setLevel(0);
        if (rig) rig.apply({ type: 'speech', value: 'stopped' });
        this.onStatus({ ...(this.health || {}), speaking: false });
        // utterance fully played — release any sequencer waiting on it
        if (this._resolveDone) { const r = this._resolveDone; this._resolveDone = null; r(); }
        // merge each segment into ONE buffer: replaying hundreds of tiny nodes
        // was what made replay stutter
        const merged = this.capture
          .slice()
          .sort((a, b) => (a.ev.index || 0) - (b.ev.index || 0))
          .map(c => {
            const n = c.chunks.reduce((sum, x) => sum + x.length, 0);
            const samples = new Float32Array(n);
            let o = 0;
            for (const x of c.chunks) { samples.set(x, o); o += x.length; }
            return { ev: c.ev, samples };
          });
        this.capture = [];
        if (merged.length) this.onCached({ segments: merged.map(m => m.ev), capture: merged });
      }
      return level;
    }

    /* Replay a cached take: one buffer per segment, no network, no billing. */
    async playCached(take) {
      if (!take || !take.capture || !take.capture.length) return false;
      this.stop('replay');
      const ctx = this._ensureAudio();
      this.playing = true;
      this.cursor = ctx.currentTime + 0.08;
      this.cues = [];
      this.pendingQueue = [];
      this._segEvents = 0;
      this._fillSeg = null;
      this._fillParts = [];
      this._firedSegs = new Set();
      this.capture = [];
      this.activeSpeaker = null;
      this.metrics = { requestedAt: performance.now(), cached: true, firstAudioMs: 0 };
      this.onMetrics(this.metrics);
      for (const seg of take.capture) {
        if (!seg || !seg.samples || !seg.samples.length) continue;
        const buf = ctx.createBuffer(1, seg.samples.length, 24000);
        buf.getChannelData(0).set(seg.samples);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.analyser);
        const at = this.cursor;
        src.start(at);
        this.sources.add(src);
        src.onended = () => this.sources.delete(src);
        this.cues.push({ at, ev: seg.ev });
        this.cursor = at + buf.duration + Math.max(0, (seg.ev.pause_after_ms || 0) / 1000);
      }
      this.cues.sort((a, b) => a.at - b.at);
      this.onLog({ type: 'replay', message: 'replaying cached audio — no provider call' });
      return true;
    }
  }

  function concat(a, b) {
    if (!a.length) return b;
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  window.TTSClient = TTSClient;
})();
