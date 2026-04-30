/**
 * @file channel-map.mod.js - ES5 module for wb-rules v2.38
 * @description Channel Map scenario class that extends ScenarioBase.
 *   Copies values between MQTT controls according to
 *   direction (forward, backward, or both).
 *   Uses a single whenChanged rule with a source-to-targets lookup map.
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;

var loggerFileLabel = 'WBSC-channel-map-mod';
var log = new Logger(loggerFileLabel);

var VALID_DIRECTIONS = ['forward', 'backward', 'both'];

/**
 * @typedef {Object} LinkEntry
 * @property {string} mqttTopicA - First MQTT topic 'device/control'
 * @property {string} direction - Direction: 'forward', 'backward', or 'both'
 * @property {string} mqttTopicB - Second MQTT topic 'device/control'
 */

/**
 * @typedef {Object} ChannelMapConfig
 * @property {string} [idPrefix] - Optional prefix for scenario ID
 * @property {Array<LinkEntry>} mqttTopicsLinks - List of links
 */

/**
 * @typedef {Object<string, string[]>} SourceMap
 * Map of source MQTT topic to array of target MQTT topics.
 * Example: { 'wb-gpio/A1_OUT': ['wb-gpio/A2_OUT', 'wb-gpio/A3_OUT'] }
 */

/**
 * Channel Map scenario implementation
 * @class ChannelMapScenario
 * @extends ScenarioBase
 */
function ChannelMapScenario() {
  ScenarioBase.call(this);

  /**
   * Context object for storing scenario runtime state
   * @type {Object}
   */
  this.ctx = {
    hasIncorrectLinks: false,
    // Cascade counter: incremented on each user press.
    // After 5 presses: cascadeId = 5
    cascadeId: 0,
    // Topic : cascade ID when last written.
    // { 'wb-gpio/A1_OUT': 5, 'wb-gpio/A2_OUT': 5 }
    writtenInCascade: {},
    // Topic : true if we wrote (cleared on echo).
    // { 'wb-gpio/A2_OUT': true }
    echoExpected: {},
  };
}

// Set up inheritance
ChannelMapScenario.prototype = Object.create(ScenarioBase.prototype);
ChannelMapScenario.prototype.constructor = ChannelMapScenario;

/**
 * Generates name identifiers for virtual device and rules
 * @param {string} idPrefix - ID prefix for this scenario instance
 * @returns {Object} Generated names
 */
ChannelMapScenario.prototype.generateNames = function (idPrefix) {
  var scenarioPrefix = 'wbsc_';
  return {
    vDevice: scenarioPrefix + idPrefix,
    ruleMap: scenarioPrefix + idPrefix + '_map',
    ruleEnable: scenarioPrefix + idPrefix + '_enable',
  };
};

/**
 * Get configuration for waiting for controls
 * @param {ChannelMapConfig} cfg - Configuration object
 * @returns {Object} Waiting configuration object
 */
ChannelMapScenario.prototype.defineControlsWaitConfig = function (cfg) {
  var allTopics = [];
  for (var i = 0; i < cfg.mqttTopicsLinks.length; i++) {
    var l = cfg.mqttTopicsLinks[i];
    if (allTopics.indexOf(l.mqttTopicA) === -1) {
      allTopics.push(l.mqttTopicA);
    }
    if (allTopics.indexOf(l.mqttTopicB) === -1) {
      allTopics.push(l.mqttTopicB);
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
  if (
    !Array.isArray(cfg.mqttTopicsLinks) ||
    cfg.mqttTopicsLinks.length === 0
  ) {
    log.error('At least one link is required');
    return false;
  }

  for (var i = 0; i < cfg.mqttTopicsLinks.length; i++) {
    var l = cfg.mqttTopicsLinks[i];

    if (!l.mqttTopicA || !l.mqttTopicB) {
      log.error('Link [{}]: both channels are required', i);
      return false;
    }

    // Direct loop check
    if (l.mqttTopicA === l.mqttTopicB) {
      log.error('Link [{}]: channels must differ: "{}"', i, l.mqttTopicA);
      return false;
    }

    if (VALID_DIRECTIONS.indexOf(l.direction) === -1) {
      log.error('Link [{}]: invalid direction "{}"', i, l.direction);
      return false;
    }

    // Duplicate/overlap check against all previous links
    for (var j = 0; j < i; j++) {
      var prev = cfg.mqttTopicsLinks[j];
      var samePair =
        (l.mqttTopicA === prev.mqttTopicA &&
          l.mqttTopicB === prev.mqttTopicB) ||
        (l.mqttTopicA === prev.mqttTopicB &&
          l.mqttTopicB === prev.mqttTopicA);

      if (!samePair) continue;

      // When A/B are swapped, forward/backward are inverted
      var existingDir = prev.direction;
      if (
        existingDir !== 'both' &&
        l.mqttTopicA === prev.mqttTopicB &&
        l.mqttTopicB === prev.mqttTopicA
      ) {
        existingDir = existingDir === 'forward' ? 'backward' : 'forward';
      }

      if (existingDir === 'both') {
        log.warning(
          'Link [{}]: already covered by link [{}]' +
            ' ("{}" both "{}"), this link has no effect',
          i,
          j,
          prev.mqttTopicA,
          prev.mqttTopicB
        );
      } else if (l.direction === 'both') {
        log.warning(
          'Link [{}]: "both" covers link [{}]' +
            ' ("{}" {} "{}"), link [{}] has no effect',
          i,
          j,
          prev.mqttTopicA,
          prev.direction,
          prev.mqttTopicB,
          j
        );
      } else if (l.direction === existingDir) {
        log.warning(
          'Link [{}]: duplicate of link [{}]' +
            ' ("{}" {} "{}"), this link has no effect',
          i,
          j,
          prev.mqttTopicA,
          prev.direction,
          prev.mqttTopicB
        );
      }
    }

    var typeA = dev[l.mqttTopicA + '#type'];
    var typeB = dev[l.mqttTopicB + '#type'];

    // Type mismatch check
    if (typeA && typeB && typeA !== typeB) {
      log.warning(
        'Link [{}]: type mismatch: "{}" ({}) and "{}" ({})',
        i,
        l.mqttTopicA,
        typeA,
        l.mqttTopicB,
        typeB
      );
      this.ctx.hasIncorrectLinks = true;
    }

    var minA = dev[l.mqttTopicA + '#min'];
    var maxA = dev[l.mqttTopicA + '#max'];
    var minB = dev[l.mqttTopicB + '#min'];
    var maxB = dev[l.mqttTopicB + '#max'];

    // Min/max constraints check
    var hasConstraintsA = minA !== undefined || maxA !== undefined;
    var hasConstraintsB = minB !== undefined || maxB !== undefined;

    if (hasConstraintsA && hasConstraintsB) {
      if (minA !== minB || maxA !== maxB) {
        log.warning(
          'Link [{}]: min/max differ:' +
            ' "{}" (min:{}, max:{})' +
            ' and "{}" (min:{}, max:{})',
          i,
          l.mqttTopicA,
          minA,
          maxA,
          l.mqttTopicB,
          minB,
          maxB
        );
        this.ctx.hasIncorrectLinks = true;
      }
    }
  }

  return true;
};

/**
 * Builds a lookup map: source topic to array of target topics
 * @param {Array<LinkEntry>} mqttTopicsLinks - List of links
 * @returns {SourceMap} Map of source to targets
 */
function buildSourceMap(mqttTopicsLinks) {
  var map = {};
  for (var i = 0; i < mqttTopicsLinks.length; i++) {
    var l = mqttTopicsLinks[i];

    if (l.direction === 'forward') {
      addToMap(map, l.mqttTopicA, l.mqttTopicB);
    } else if (l.direction === 'backward') {
      addToMap(map, l.mqttTopicB, l.mqttTopicA);
    } else if (l.direction === 'both') {
      addToMap(map, l.mqttTopicA, l.mqttTopicB);
      addToMap(map, l.mqttTopicB, l.mqttTopicA);
    }
  }
  return map;
}

/**
 * Adds a mapping from source to target in the map, avoiding duplicates
 * @param {SourceMap} map - The map to modify
 * @param {string} source - Source MQTT topic
 * @param {string} target - Target MQTT topic
 */
function addToMap(map, source, target) {
  if (!map[source]) {
    map[source] = [];
  }
  if (map[source].indexOf(target) === -1) {
    map[source].push(target);
  }
}

/**
 * Adds custom controls to virtual device
 * @param {ChannelMapScenario} self - Reference to the ChannelMapScenario instance
 */
function addCustomControlsToVirtualDevice(self) {
  if (self.ctx.hasIncorrectLinks) {
    self.vd.devObj.addControl('warning', {
      title: {
        en: 'Some links are incorrect, see logs',
        ru: 'Некоторые связи работают некорректно, см. логи',
      },
      type: 'text',
      value: '',
      readonly: true,
      forceDefault: true,
      order: 2,
    });
  }
}

/**
 * Converts a value to match the target control's type
 * according to ES5 coercion rules and Wiren Board MQTT Conventions.
 *
 * @param {*} value - Value to convert
 * @param {string} targetType - Target control type from meta
 * @returns {*} Converted value
 */
function convertValueForType(value, targetType) {
  if (targetType === 'switch' || targetType === 'alarm') {
    // String values from MQTT/text controls need explicit handling:
    // Boolean('false') and Boolean('0') both return true (any
    // non-empty string is truthy in JS), which is wrong here.
    if (typeof value === 'string') {
      var lower = value.toLowerCase();
      if (lower === 'false' || lower === '0') {
        return false;
      }
    }
    return Boolean(value);
  }
  if (targetType === 'text' || targetType === 'rgb') {
    return String(value);
  }
  if (
    // Primary numeric types
    targetType === 'range' ||
    targetType === 'value' ||
    targetType === 'unixtime' ||
    targetType === 'w1-id' ||
    // Deprecated numeric types (still used by some devices)
    targetType === 'temperature' ||
    targetType === 'rel_humidity' ||
    targetType === 'atmospheric_pressure' ||
    targetType === 'rainfall' ||
    targetType === 'wind_speed' ||
    targetType === 'power' ||
    targetType === 'power_consumption' ||
    targetType === 'voltage' ||
    targetType === 'water_flow' ||
    targetType === 'water_consumption' ||
    targetType === 'resistance' ||
    targetType === 'concentration' ||
    targetType === 'heat_power' ||
    targetType === 'heat_energy' ||
    targetType === 'current' ||
    targetType === 'pressure' ||
    targetType === 'illuminance' ||
    targetType === 'sound_level'
  ) {
    var num = Number(value);
    if (isNaN(num)) {
      log.warning(
        'Value "{}" cannot be converted to number' +
          ' (target type "{}"), returning 0',
        value,
        targetType
      );
      return 0;
    }
    return num;
  }
  // Unknown type: return original value and log warning
  log.warning(
    'Unknown control type "{}", returning original value',
    targetType
  );
  return value;
}

/**
 * Creates the link rule that copies values from sources
 * to targets. Uses cascade counter (ctx) to prevent
 * infinite loops with pushbutton controls.
 *
 * @param {ChannelMapScenario} self - Reference to the ChannelMapScenario instance
 * @param {SourceMap} sourceMap - Map of source to targets
 * @returns {boolean} True if rule created successfully
 */
function createLinkRule(self, sourceMap) {
  log.debug('Creating link rule');
  var sources = Object.keys(sourceMap);
  var ctx = self.ctx;

  var ruleId = defineRule(self.genNames.ruleMap, {
    whenChanged: sources,
    then: function onSourceChanged(newValue, devName, cellName) {
      var source = devName + '/' + cellName;
      var targets = sourceMap[source];

      // --- Pushbutton cascade protection ---
      // Pushbutton is stateless (value always 1), so
      // dev[target] !== newValue can't prevent loops.
      // Instead, each user press gets a unique cascadeId.
      // All writes within one cascade share the same ID.
      // If a target was already written in this cascade,
      // it is skipped. Works for all topologies: pairs,
      // chains, meshes, and cycles.
      //
      // Non-pushbutton: standard check !== newValue.

      var sourceType = dev[source + '#type'];
      var isPbSource = sourceType === 'pushbutton';
      var isEcho = isPbSource && ctx.echoExpected[source];

      if (isPbSource) {
        if (isEcho) {
          delete ctx.echoExpected[source];
        } else {
          ctx.cascadeId++;
          ctx.writtenInCascade[source] = ctx.cascadeId;
        }
      } else {
        // New cascade so stale writtenInCascade entries
        // from previous cascades don't block writes
        ctx.cascadeId++;
      }

      for (var i = 0; i < targets.length; i++) {
        var target = targets[i];
        var targetType = dev[target + '#type'];
        var isPbTarget = targetType === 'pushbutton';

        if (isPbTarget) {
          if (ctx.writtenInCascade[target] === ctx.cascadeId) {
            continue;
          }
          ctx.echoExpected[target] = true;
          ctx.writtenInCascade[target] = ctx.cascadeId;
          // For pushbutton, the actual value doesn't matter — any write triggers a press.
          // Using `true` is just a convention; `false`, `1`, or `"press"` would also work.
          dev[target] = true;
          log.debug(
            'Source "{}" (type "{}") triggered pushbutton target "{}"',
            source,
            sourceType,
            target
          );
        } else {
          var convertedValue = convertValueForType(newValue, targetType);
          if (dev[target] !== convertedValue) {
            dev[target] = convertedValue;
            log.debug(
              'Source "{}" (type "{}") value "{}" converted to "{}"' +
                ' written to target "{}" (type "{}")',
              source,
              sourceType,
              newValue,
              convertedValue,
              target,
              targetType
            );
          }
        }
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
 * Create all rules for the scenario.
 * @param {ChannelMapScenario} self - Reference to the ChannelMapScenario instance
 * @param {SourceMap} sourceMap - Map of source to targets
 * @returns {boolean} True if all rules created successfully
 */
function createRules(self, sourceMap) {
  log.debug('Creating all rules');

  if (!createLinkRule(self, sourceMap)) {
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
ChannelMapScenario.prototype.initSpecific = function (deviceTitle, cfg) {
  /**
   * NOTE: This method is executed ONLY when:
   * - Base initialization is complete
   * - Configuration is valid
   * - All referenced controls exist in the system
   *
   * The async initialization chain guarantees that all prerequisites are met.
   * No need to re-validate or check control existence here.
   */
  log.debug('Start init channel map scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  addCustomControlsToVirtualDevice(this);

  var sourceMap = buildSourceMap(cfg.mqttTopicsLinks);
  var rulesCreated = createRules(this, sourceMap);

  if (rulesCreated) {
    this.setState(ScenarioState.NORMAL);
    log.debug(
      'Channel Map scenario initialized for device "{}"',
      deviceTitle
    );
  }

  return rulesCreated;
};

exports.ChannelMapScenario = ChannelMapScenario;
