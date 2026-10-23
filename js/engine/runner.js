// Runs player code on drones against game time: start / stop / pause / step.
import { Interpreter, Y } from '../lang/interpreter.js';
import { GameError, locOf } from '../lang/errors.js';
import { Drone } from './drone.js';

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Runner {
  constructor(game) {
    this.game = game;
    this.state = 'idle'; // idle | running | paused
    this.drones = [];
    this.entry = null;
    this.stepTarget = null;
    this.lastError = null;
    this.host = null;
    this.nextDroneId = 1;
  }

  get settings() {
    return this.game.config.settings;
  }

  makeInterpreter(drone) {
    if (!this.host) this.host = this.game.api.createHost();
    const s = this.settings;
    const I = new Interpreter({
      host: this.host,
      costs: s.costs && s.costs.language,
      maxCallDepth: (s.game && s.game.maxCallDepth) || 400,
    });
    I.drone = drone;
    I.game = this.game;
    return I;
  }

  isActive() {
    return this.state === 'running' || this.state === 'paused';
  }

  // Starts running a script tab. Returns { ok, error }.
  start(scriptName) {
    if (this.isActive()) this.stop('restart', true);
    const game = this.game;
    const script = game.scripts.find((s) => s.name === scriptName);
    if (!script) return { ok: false };
    try {
      game.api.compile(script.name, script.code);
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
      this.lastError = e;
      game.events.emit('runError', { error: e, module: e.module || script.name, drone: 0, phase: 'compile' });
      return { ok: false, error: e };
    }
    const d = game.mainDrone;
    d.interp = this.makeInterpreter(d);
    d.gen = d.interp.runModule(script.name);
    d.time = game.time;
    d.state = 'running';
    d.tickCount = 0;
    d.execSpeed = 0;
    d.result = undefined;
    d.idleTicks = 0;
    d.waitingFor = null;
    this.drones = [d];
    this.nextDroneId = 1;
    this.entry = script.name;
    this.state = 'running';
    this.lastError = null;
    this.stepTarget = null;
    game.warned.clear();
    game.stats.runs++;
    game.events.emit('runStart', { script: script.name });
    return { ok: true };
  }

  stop(reason = 'user', silent = false) {
    if (!this.isActive()) return;
    this.state = 'idle';
    this.stepTarget = null;
    for (const d of this.drones) {
      d.state = 'idle';
      d.gen = null;
    }
    this.removeExtraDrones();
    if (!silent) this.game.events.emit('runEnd', { reason });
  }

  removeExtraDrones() {
    this.drones = this.drones.filter((d) => d.id === 0);
    this.game.events.emit('drones', {});
  }

  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.game.events.emit('runPause', {});
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.stepTarget = null;
    this.game.events.emit('runResume', {});
  }

  activeDroneCount() {
    return this.drones.filter((d) => d.state === 'running' || d.state === 'waiting').length;
  }

  // Runs one drone until its next pause point. Returns the yielded value or 'done' / 'error'.
  stepDrone(d) {
    const I = d.interp;
    let r;
    try {
      r = d.gen.next();
    } catch (e) {
      this.droneError(d, e);
      return 'error';
    }
    const ticks = I.ticks;
    I.ticks = 0;
    if (ticks > 0) {
      d.time += ticks / d.tickRate();
      d.tickCount += ticks;
      d.idleTicks = 0;
    } else if (++d.idleTicks > 2000) {
      // Safety net: never let a drone spin forever without time passing.
      d.time += 1 / d.tickRate();
      d.idleTicks = 0;
    }
    if (r.done) {
      this.droneFinished(d, r.value);
      return 'done';
    }
    if (r.value === Y.WAIT) {
      d.state = 'waiting';
    }
    return r.value;
  }

  // Advances running drones up to game time `target` (within a wall-clock budget).
  // Returns the game time actually reached.
  update(target, budgetMs = 12) {
    if (this.state !== 'running') return target;
    const deadline = nowMs() + budgetMs;
    let steps = 0;
    for (;;) {
      let d = null;
      for (const x of this.drones) {
        if (x.state === 'running' && x.time < target && (!d || x.time < d.time)) d = x;
      }
      if (!d) break;
      this.stepDrone(d);
      if (this.state !== 'running') return this.state === 'idle' ? target : this.minDroneTime(target);
      if ((++steps & 31) === 0 && nowMs() > deadline) {
        return Math.max(this.game.time, this.minDroneTime(target));
      }
    }
    for (const x of this.drones) {
      if (x.state === 'waiting' && x.time < target) x.time = target;
    }
    return target;
  }

  minDroneTime(target) {
    let t = target;
    for (const x of this.drones) if (x.state === 'running') t = Math.min(t, x.time);
    return t;
  }

  // Step button: execute until the next line of the main drone.
  step() {
    const game = this.game;
    if (this.state === 'idle') {
      const r = this.start(game.activeScript);
      if (!r.ok) return;
      this.state = 'paused';
      const d = game.mainDrone;
      const v = this.stepDrone(d); // run to the first statement
      if (v === 'done' || v === 'error') return;
      this.stepTarget = d.time;
      game.events.emit('runPause', { step: true });
      return;
    }
    if (this.state === 'running') this.pause();
    if (this.state !== 'paused') return;
    const d = this.drones.find((x) => x.state === 'running') || game.mainDrone;
    if (d.state !== 'running') return;
    let guard = 0;
    for (;;) {
      const v = this.stepDrone(d);
      if (v === 'done' || v === 'error' || this.state === 'idle') return;
      if (v === Y.STMT || v === Y.LOOP || v === Y.WAIT) break;
      if (++guard > 100000) break;
    }
    // Other drones catch up.
    for (const x of this.drones) {
      let g2 = 0;
      while (x !== d && x.state === 'running' && x.time < d.time && g2++ < 100000) {
        if (this.stepDrone(x) === 'error') return;
      }
    }
    this.stepTarget = Math.max(game.time, d.time);
    game.events.emit('runPause', { step: true });
  }

  droneFinished(d, value) {
    d.state = 'done';
    d.result = value;
    d.gen = null;
    for (const x of this.drones) {
      if (x.state === 'waiting' && x.waitingFor === d) {
        x.state = 'running';
        x.time = Math.max(x.time, d.time);
      }
    }
    if (d.id !== 0) this.game.events.emit('droneDone', { drone: d.id });
    if (!this.drones.some((x) => x.state === 'running' || x.state === 'waiting')) {
      this.state = 'idle';
      this.stepTarget = null;
      this.removeExtraDrones();
      this.game.events.emit('runEnd', { reason: 'done' });
    }
  }

  droneError(d, e) {
    let err = e;
    if (!(e instanceof GameError)) {
      // A bug in the game itself, or a JS engine limit (e.g. stack overflow).
      const msg = String((e && e.message) || e);
      err = new GameError(/call stack/i.test(msg) ? 'recursion' : 'internal', { message: msg }, null);
      console.error(e);
    }
    const cur = d.interp && d.interp.currentNode;
    if (!err.loc && cur) err.loc = locOf(cur);
    if (!err.module && cur) err.module = cur._mod;
    this.lastError = err;
    d.state = 'error';
    const all = this.drones.slice();
    this.state = 'idle';
    this.stepTarget = null;
    for (const x of all) {
      if (x.state === 'running' || x.state === 'waiting') x.state = 'idle';
      x.gen = null;
    }
    this.removeExtraDrones();
    this.game.events.emit('runError', { error: err, module: err.module || this.entry, drone: d.id, phase: 'run' });
  }

  // Megafarm: start a new drone on `fn` at the parent's position.
  spawnDrone(parent, fn, args, t) {
    const max = this.game.maxDrones();
    if (this.activeDroneCount() >= max) return null;
    const d = new Drone(this.game, this.nextDroneId++, { x: parent.x, y: parent.y, hat: parent.hat });
    d.interp = this.makeInterpreter(d);
    d.interp.modules = parent.interp.modules;
    d.gen = d.interp.runFunction(fn, args.map((a) => a));
    d.time = t;
    d.state = 'running';
    this.drones.push(d);
    this.game.events.emit('drones', { spawned: d.id });
    return d;
  }
}
