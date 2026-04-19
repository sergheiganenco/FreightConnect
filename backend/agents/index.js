/**
 * Agent Initializer — creates and starts all AI agents via the orchestrator.
 *
 * Called from app.js at server startup. Returns the orchestrator instance
 * so routes can query agent status and toggle agents at runtime.
 */

const { AgentOrchestrator } = require('./AgentFramework');
const LoadMatchingAgent = require('./LoadMatchingAgent');
const PricingAgent = require('./PricingAgent');
const DispatchAgent = require('./DispatchAgent');
const DemandForecastAgent = require('./DemandForecastAgent');
const CarrierRiskAgent = require('./CarrierRiskAgent');

/** @type {AgentOrchestrator|null} */
let _orchestrator = null;

/**
 * Initialize all AI agents and start their timers.
 * @returns {AgentOrchestrator}
 */
function initializeAgents() {
  const orchestrator = new AgentOrchestrator();

  orchestrator.register(new LoadMatchingAgent());
  orchestrator.register(new PricingAgent());
  orchestrator.register(new DispatchAgent());
  orchestrator.register(new DemandForecastAgent());
  orchestrator.register(new CarrierRiskAgent());

  orchestrator.startAll();
  _orchestrator = orchestrator;

  console.log('[AI] All agents initialized and started');
  return orchestrator;
}

/**
 * Retrieve the singleton orchestrator (for use in routes).
 * @returns {AgentOrchestrator|null}
 */
function getOrchestrator() {
  return _orchestrator;
}

module.exports = { initializeAgents, getOrchestrator };
