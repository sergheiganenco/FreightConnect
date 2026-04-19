/**
 * AgentFramework — Core autonomous agent infrastructure for FreightConnect.
 *
 * Provides a base `Agent` class (extend and implement `execute()`) and an
 * `AgentOrchestrator` that manages registration, lifecycle, and status
 * reporting for all agents in the system.
 *
 * Each agent runs on a configurable interval and emits 'run' / 'error' events
 * that the orchestrator (or external observers) can subscribe to.
 */

const EventEmitter = require('events');

class Agent extends EventEmitter {
  /**
   * @param {string} name   — unique agent identifier
   * @param {Object} config
   * @param {boolean}  [config.enabled=true]       — start automatically?
   * @param {number}   [config.intervalMs=60000]    — tick interval in ms
   */
  constructor(name, config = {}) {
    super();
    this.name = name;
    this.enabled = config.enabled !== false;
    this.intervalMs = config.intervalMs || 60000;
    this.lastRun = null;
    this.metrics = { runs: 0, actions: 0, errors: 0 };
    this._timer = null;
  }

  /**
   * Subclasses MUST override this method.
   * @returns {Promise<number>} — number of actions taken this tick
   */
  async execute() {
    throw new Error('Subclass must implement execute()');
  }

  /** Start the recurring timer. No-op if agent is disabled. */
  start() {
    if (!this.enabled) return;
    this._timer = setInterval(() => this._run(), this.intervalMs);
    console.log(`[Agent:${this.name}] Started (interval: ${this.intervalMs}ms)`);
  }

  /** Stop the recurring timer. */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log(`[Agent:${this.name}] Stopped`);
  }

  /** Toggle enabled state at runtime. */
  setEnabled(flag) {
    this.enabled = !!flag;
    if (!this.enabled) this.stop();
  }

  /** @private — wraps execute() with metrics and error handling */
  async _run() {
    try {
      this.metrics.runs++;
      this.lastRun = new Date();
      const actions = await this.execute();
      this.metrics.actions += (actions || 0);
      this.emit('run', { agent: this.name, actions, timestamp: this.lastRun });
    } catch (err) {
      this.metrics.errors++;
      this.emit('error', { agent: this.name, error: err.message });
      console.error(`[Agent:${this.name}] Error:`, err.message);
    }
  }

  /** Return a JSON-safe status snapshot. */
  getStatus() {
    return {
      name: this.name,
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      lastRun: this.lastRun,
      metrics: { ...this.metrics },
    };
  }
}

/**
 * Manages a collection of agents — register, start/stop all, query status.
 */
class AgentOrchestrator {
  constructor() {
    this.agents = new Map();
  }

  /** Register an agent instance. */
  register(agent) {
    this.agents.set(agent.name, agent);
  }

  /** Start every registered agent. */
  startAll() {
    this.agents.forEach((a) => a.start());
  }

  /** Stop every registered agent. */
  stopAll() {
    this.agents.forEach((a) => a.stop());
  }

  /** Return status array for all agents. */
  getStatus() {
    return Array.from(this.agents.values()).map((a) => a.getStatus());
  }

  /** Retrieve a single agent by name. */
  getAgent(name) {
    return this.agents.get(name);
  }
}

module.exports = { Agent, AgentOrchestrator };
