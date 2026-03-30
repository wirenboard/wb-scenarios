/**
 * @file virtual-link.mod.js - ES5 module for wb-rules v2.38
 * @description Virtual Link scenario class that extends ScenarioBase.
 *   Copies values from source MQTT controls to destination controls.
 *   Uses a single whenChanged rule with a source→destinations lookup map.
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState =
  require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;

var loggerFileLabel = 'WBSC-virtual-link-mod';
var log = new Logger(loggerFileLabel);

/**
 * @typedef {Object} LinkEntry
 * @property {string} source - Source MQTT topic 'device/control'
 * @property {string} destination - Destination MQTT topic
 */

/**
 * @typedef {Object} VirtualLinkConfig
 * @property {string} [idPrefix] - Optional prefix for scenario ID
 * @property {Array<LinkEntry>} links - List of links
 */

/**
 * @typedef {Object<string, string[]>} SourceMap
 * Map of source topic to array of destination topics.
 * Example: { 'wb-gpio/A1_OUT': ['wb-gpio/A2_OUT', 'wb-gpio/A3_OUT'] }
 */

/**
 * Virtual Link scenario implementation
 * @class VirtualLinkScenario
 * @extends ScenarioBase
 */
function VirtualLinkScenario() {
  ScenarioBase.call(this);

  /**
   * Context object for storing scenario runtime state
   * @type {Object}
   */
  this.ctx = {};
}

// Set up inheritance
VirtualLinkScenario.prototype = Object.create(ScenarioBase.prototype);
VirtualLinkScenario.prototype.constructor = VirtualLinkScenario;

/**
 * Generates name identifiers for virtual device and rules
 * @param {string} idPrefix - ID prefix for this scenario instance
 * @returns {Object} Generated names
 */
VirtualLinkScenario.prototype.generateNames =
  function (idPrefix) {
    var scenarioPrefix = 'wbsc_';
    return {
      vDevice: scenarioPrefix + idPrefix,
      ruleLink: scenarioPrefix + idPrefix + '_link',
      ruleEnable: scenarioPrefix + idPrefix + '_enable',
    };
  };

/**
 * Get configuration for waiting for controls
 * @param {VirtualLinkConfig} cfg - Configuration object
 * @returns {Object} Waiting configuration object
 */
VirtualLinkScenario.prototype.defineControlsWaitConfig =
  function (cfg) {
    var allTopics = [];
    for (var i = 0; i < cfg.links.length; i++) {
      var l = cfg.links[i];
      if (allTopics.indexOf(l.source) === -1) {
        allTopics.push(l.source);
      }
      if (allTopics.indexOf(l.destination) === -1) {
        allTopics.push(l.destination);
      }
    }
    return { controls: allTopics };
  };

/**
 * Configuration validation
 * @param {VirtualLinkConfig} cfg - Configuration object
 * @returns {boolean} True if configuration is valid
 */
VirtualLinkScenario.prototype.validateCfg = function (cfg) {
  if (!Array.isArray(cfg.links) || cfg.links.length === 0) {
    log.error('At least one link is required');
    return false;
  }

  var sources = {};
  var destinations = {};

  for (var i = 0; i < cfg.links.length; i++) {
    var l = cfg.links[i];

    if (!l.source || !l.destination) {
      log.error(
        'Link [{}]: source and destination are required',
        i
      );
      return false;
    }

    // Direct loop check
    if (l.source === l.destination) {
      log.error(
        'Link [{}]: source and destination must differ: "{}"',
        i,
        l.source
      );
      return false;
    }

    sources[l.source] = true;
    destinations[l.destination] = true;
  }

  // Indirect loop check within this scenario
  for (var dest in destinations) {
    if (sources[dest]) {
      log.error(
        'Indirect loop detected: "{}" is both source and'
        + ' destination in this scenario',
        dest
      );
      return false;
    }
  }

  checkTypeMismatch(cfg.links);

  return true;
};

/**
 * Builds a lookup map: source topic -> array of destinations
 * @param {Array<LinkEntry>} links - List of links
 * @returns {SourceMap} Map of source -> destinations
 */
function buildSourceMap(links) {
  var map = {};
  for (var i = 0; i < links.length; i++) {
    var src = links[i].source;
    var dst = links[i].destination;
    if (!map[src]) {
      map[src] = [];
    }
    map[src].push(dst);
  }
  return map;
}

/**
 * Logs warnings for links where source and destination
 * control types differ
 * @param {Array<LinkEntry>} links - List of links
 */
function checkTypeMismatch(links) {
  for (var i = 0; i < links.length; i++) {
    var l = links[i];
    var srcType = dev[l.source + '#type'];
    var dstType = dev[l.destination + '#type'];
    if (srcType && dstType && srcType !== dstType) {
      log.warning(
        'Type mismatch in link [{}]: "{}" ({}) -> "{}" ({})',
        i,
        l.source,
        srcType,
        l.destination,
        dstType
      );
    }
  }
}

/**
 * Copies current source values to all destinations
 * @param {SourceMap} sourceMap - Source to destinations map
 */
function initialSync(sourceMap) {
  for (var source in sourceMap) {
    var value = dev[source];
    var dests = sourceMap[source];
    for (var i = 0; i < dests.length; i++) {
      dev[dests[i]] = value;
    }
  }
}

/**
 * Creates the link rule that copies values from sources to destinations.
 * @param {VirtualLinkScenario} self - Scenario instance
 * @param {SourceMap} sourceMap - Source to destinations map
 * @returns {boolean} True if rule created successfully
 */
function createLinkRule(self, sourceMap) {
  log.debug('Creating link rule');
  var sources = Object.keys(sourceMap);

  var ruleId = defineRule(self.genNames.ruleLink, {
    whenChanged: sources,
    then: function onSourceChanged(newValue, devName, cellName) {
      var dests = sourceMap[devName + '/' + cellName];
      if (!dests) return;
      for (var i = 0; i < dests.length; i++) {
        dev[dests[i]] = newValue;
      }
    },
  });

  if (!ruleId) {
    log.error('Failed to create link rule');
    return false;
  }
  log.debug('Link rule created');
  self.addRule(ruleId);
  return true;
}

/**
 * Creates a rule that re-syncs values when the scenario is re-enabled.
 * Intentionally NOT registered via addRule() so it stays active
 * even when the scenario is disabled.
 * @param {VirtualLinkScenario} self - Scenario instance
 * @param {SourceMap} sourceMap - Source to destinations map
 * @returns {boolean} True if rule created successfully
 */
function createEnableRule(self, sourceMap) {
  log.debug('Creating enable rule');

  var ruleId = defineRule(self.genNames.ruleEnable, {
    whenChanged: [self.genNames.vDevice + '/rule_enabled'],
    then: function onRuleEnabledChanged(newValue) {
      if (newValue) {
        log.debug('Scenario re-enabled, syncing values');
        initialSync(sourceMap);
      }
    },
  });

  if (!ruleId) {
    log.error('Failed to create enable rule');
    return false;
  }
  log.debug('Enable rule created');
  return true;
}

/**
 * Create all rules for the scenario.
 * @param {VirtualLinkScenario} self - Scenario instance
 * @param {SourceMap} sourceMap - Source to destinations map
 * @returns {boolean} True if all rules created successfully
 */
function createRules(self, sourceMap) {
  log.debug('Creating all rules');

  if (!createLinkRule(self, sourceMap)) {
    return false;
  }
  if (!createEnableRule(self, sourceMap)) {
    return false;
  }

  return true;
}

/**
 * Scenario initialization
 * @param {string} deviceTitle - Virtual device title
 * @param {VirtualLinkConfig} cfg - Configuration object
 * @returns {boolean} True if initialization succeeded
 */
VirtualLinkScenario.prototype.initSpecific =
  function (deviceTitle, cfg) {
    log.debug('Start init virtual link scenario');
    log.setLabel(loggerFileLabel + '/' + this.idPrefix);

    var sourceMap = buildSourceMap(cfg.links);

    var rulesCreated = createRules(this, sourceMap);

    if (rulesCreated) {
      initialSync(sourceMap);

      this.setState(ScenarioState.NORMAL);
      log.debug(
        'Virtual link scenario initialized for device "{}"',
        deviceTitle
      );
    }

    return rulesCreated;
  };

exports.VirtualLinkScenario = VirtualLinkScenario;
