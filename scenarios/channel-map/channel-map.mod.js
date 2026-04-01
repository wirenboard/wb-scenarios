/**
 * @file channel-map.mod.js - ES5 module for wb-rules v2.38
 * @description Virtual Link scenario class that extends ScenarioBase.
 *   Copies values from mqttTopicInput MQTT controls to mqttTopicOutput controls.
 *   Uses a single whenChanged rule with a mqttTopicInput→mqttTopicOutputs lookup map.
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState =
  require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;

var loggerFileLabel = 'WBSC-channel-map-mod';
var log = new Logger(loggerFileLabel);

/**
 * @typedef {Object} LinkEntry
 * @property {string} mqttTopicInput - Source MQTT topic 'device/control'
 * @property {string} mqttTopicOutput - Destination MQTT topic
 */

/**
 * @typedef {Object} ChannelMapConfig
 * @property {string} [idPrefix] - Optional prefix for scenario ID
 * @property {Array<LinkEntry>} mqttTopicsLinks - List of links
 */

/**
 * @typedef {Object<string, string[]>} SourceMap
 * Map of mqttTopicInput topic to array of mqttTopicOutput topics.
 * Example: { 'wb-gpio/A1_OUT': ['wb-gpio/A2_OUT', 'wb-gpio/A3_OUT'] }
 */

/**
 * Virtual Link scenario implementation
 * @class ChannelMapScenario
 * @extends ScenarioBase
 */
function ChannelMapScenario() {
  ScenarioBase.call(this);

  /**
   * Context object for storing scenario runtime state
   * @type {Object}
   */
  this.ctx = {};
}

// Set up inheritance
ChannelMapScenario.prototype = Object.create(ScenarioBase.prototype);
ChannelMapScenario.prototype.constructor = ChannelMapScenario;

/**
 * Generates name identifiers for virtual device and rules
 * @param {string} idPrefix - ID prefix for this scenario instance
 * @returns {Object} Generated names
 */
ChannelMapScenario.prototype.generateNames =
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
 * @param {ChannelMapConfig} cfg - Configuration object
 * @returns {Object} Waiting configuration object
 */
ChannelMapScenario.prototype.defineControlsWaitConfig =
  function (cfg) {
    var allTopics = [];
    for (var i = 0; i < cfg.mqttTopicsLinks.length; i++) {
      var l = cfg.mqttTopicsLinks[i];
      if (allTopics.indexOf(l.mqttTopicInput) === -1) {
        allTopics.push(l.mqttTopicInput);
      }
      if (allTopics.indexOf(l.mqttTopicOutput) === -1) {
        allTopics.push(l.mqttTopicOutput);
      }
    }
    return { controls: allTopics };
  };

/**
 * Configuration validation
 * @param {ChannelMapConfig} cfg - Configuration object
 * @returns {boolean} True if configuration is valid
 */
ChannelMapScenario.prototype.validateCfg = function (cfg) {
  if (!Array.isArray(cfg.mqttTopicsLinks) || cfg.mqttTopicsLinks.length === 0) {
    log.error('At least one link is required');
    return false;
  }

  var mqttTopicInputs = {};
  var mqttTopicOutputs = {};

  for (var i = 0; i < cfg.mqttTopicsLinks.length; i++) {
    var l = cfg.mqttTopicsLinks[i];

    if (!l.mqttTopicInput || !l.mqttTopicOutput) {
      log.error(
        'Link [{}]: input and output are required',
        i
      );
      return false;
    }

    // Direct loop check
    if (l.mqttTopicInput === l.mqttTopicOutput) {
      log.error(
        'Link [{}]: input and output must differ: "{}"',
        i,
        l.mqttTopicInput
      );
      return false;
    }

    mqttTopicInputs[l.mqttTopicInput] = true;
    mqttTopicOutputs[l.mqttTopicOutput] = true;
  }

  // Indirect loop check within this scenario
  for (var dest in mqttTopicOutputs) {
    if (mqttTopicInputs[dest]) {
      log.error(
        'Indirect loop detected: "{}" is both input and'
        + ' output in this scenario',
        dest
      );
      return false;
    }
  }

  checkTypeMismatch(cfg.mqttTopicsLinks);

  return true;
};

/**
 * Builds a lookup map: mqttTopicInput topic -> array of mqttTopicOutputs
 * @param {Array<LinkEntry>} mqttTopicsLinks - List of links
 * @returns {SourceMap} Map of mqttTopicInput -> mqttTopicOutputs
 */
function buildSourceMap(mqttTopicsLinks) {
  var map = {};
  for (var i = 0; i < mqttTopicsLinks.length; i++) {
    var src = mqttTopicsLinks[i].mqttTopicInput;
    var dst = mqttTopicsLinks[i].mqttTopicOutput;
    if (!map[src]) {
      map[src] = [];
    }
    map[src].push(dst);
  }
  return map;
}

/**
 * Logs warnings for mqttTopicsLinks where mqttTopicInput and mqttTopicOutput
 * control types differ
 * @param {Array<LinkEntry>} mqttTopicsLinks - List of links
 */
function checkTypeMismatch(mqttTopicsLinks) {
  for (var i = 0; i < mqttTopicsLinks.length; i++) {
    var l = mqttTopicsLinks[i];
    var srcType = dev[l.mqttTopicInput + '#type'];
    var dstType = dev[l.mqttTopicOutput + '#type'];
    if (srcType && dstType && srcType !== dstType) {
      log.warning(
        'Type mismatch in link [{}]: "{}" ({}) -> "{}" ({})',
        i,
        l.mqttTopicInput,
        srcType,
        l.mqttTopicOutput,
        dstType
      );
    }
  }
}

/**
 * Copies current mqttTopicInput values to all mqttTopicOutputs
 * @param {SourceMap} sourceMap - mqttTopicInput to mqttTopicOutputs map
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
 * Creates the link rule that copies values from mqttTopicInputs to mqttTopicOutputs.
 * @param {ChannelMapScenario} self - Scenario instance
 * @param {SourceMap} sourceMap - mqttTopicInput to mqttTopicOutputs map
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
 * @param {ChannelMapScenario} self - Scenario instance
 * @param {SourceMap} sourceMap - mqttTopicInput to mqttTopicOutputs map
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
 * @param {ChannelMapScenario} self - Scenario instance
 * @param {SourceMap} sourceMap - mqttTopicInput to mqttTopicOutputs map
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
 * @param {ChannelMapConfig} cfg - Configuration object
 * @returns {boolean} True if initialization succeeded
 */
ChannelMapScenario.prototype.initSpecific =
  function (deviceTitle, cfg) {
    log.debug('Start init virtual link scenario');
    log.setLabel(loggerFileLabel + '/' + this.idPrefix);

    var sourceMap = buildSourceMap(cfg.mqttTopicsLinks);

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

exports.ChannelMapScenario = ChannelMapScenario;
