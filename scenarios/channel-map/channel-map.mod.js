/**
 * @file channel-map.mod.js - ES5 module for wb-rules v2.38
 * @description Channel Map scenario class that extends ScenarioBase.
 *   Copies values between MQTT controls according to direction.
 *   Uses a single whenChanged rule with a source-to-targets lookup map.
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;
var isControlTypeValid =
  require('scenarios-general-helpers.mod').isControlTypeValid;

var loggerFileLabel = 'WBSC-channel-map-mod';
var log = new Logger(loggerFileLabel);

var VALID_DIRECTIONS = ['forward', 'backward', 'both'];
var BOOL_CTRL_TYPES = ['switch', 'alarm'];

/**
 * @typedef {Object} LinkEntry
 * @property {string} mqttTopicA - First MQTT topic 'device/control'
 * @property {string} direction - Direction: 'forward', 'backward', or 'both'
 * @property {string} mqttTopicB - Second MQTT topic 'device/control'
 * @property {boolean} [invertSourceValue] - Optional, default false. If true,
 *   apply logical NOT when copying to a switch/alarm target.
 */

/**
 * @typedef {Object} ChannelMapConfig
 * @property {string} [idPrefix] - Optional prefix for scenario ID
 * @property {Array<LinkEntry>} mqttTopicsLinks - List of links
 */

/**
 * @typedef {Object} SourceTarget
 * @property {string} target - Target MQTT topic
 * @property {boolean} invertSourceValue - If true, invert boolean value before write
 */

/**
 * @typedef {Object<string, SourceTarget[]>} SourceMap
 * Map of source MQTT topic to array of {target, invertSourceValue} entries.
 * Example: { 'wb-gpio/A1_OUT': [
 *   { target: 'wb-gpio/A2_OUT', invertSourceValue: false },
 *   { target: 'wb-gpio/A3_OUT', invertSourceValue: true  }
 * ]}
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
    var link = cfg.mqttTopicsLinks[i];
    if (allTopics.indexOf(link.mqttTopicA) === -1) {
      allTopics.push(link.mqttTopicA);
    }
    if (allTopics.indexOf(link.mqttTopicB) === -1) {
      allTopics.push(link.mqttTopicB);
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
    var link = cfg.mqttTopicsLinks[i];

    if (!link.mqttTopicA || !link.mqttTopicB) {
      log.error('Link [{}]: both channels are required', i);
      return false;
    }

    // Direct loop check
    if (link.mqttTopicA === link.mqttTopicB) {
      log.error('Link [{}]: channels must differ: "{}"', i, link.mqttTopicA);
      return false;
    }

    if (VALID_DIRECTIONS.indexOf(link.direction) === -1) {
      log.error('Link [{}]: invalid direction "{}"', i, link.direction);
      return false;
    }

    var typeA = dev[link.mqttTopicA + '#type'];
    var typeB = dev[link.mqttTopicB + '#type'];

    // Inversion only makes sense for a boolean target;
    // for direction 'both' both A and B are targets.
    if (link.invertSourceValue === true) {
      var needBoolA =
        link.direction === 'backward' || link.direction === 'both';
      var needBoolB =
        link.direction === 'forward' || link.direction === 'both';

      if (
        needBoolB &&
        !isControlTypeValid(link.mqttTopicB, BOOL_CTRL_TYPES)
      ) {
        log.error(
          'Link [{}]: invertSourceValue=true with direction "{}" requires' +
            ' target channel B to be switch or alarm: "{}" (type "{}")',
          i,
          link.direction,
          link.mqttTopicB,
          typeB
        );
        return false;
      }
      if (
        needBoolA &&
        !isControlTypeValid(link.mqttTopicA, BOOL_CTRL_TYPES)
      ) {
        log.error(
          'Link [{}]: invertSourceValue=true with direction "{}" requires' +
            ' target channel A to be switch or alarm: "{}" (type "{}")',
          i,
          link.direction,
          link.mqttTopicA,
          typeA
        );
        return false;
      }
    }

    // Duplicate/overlap check against all previous links
    for (var j = 0; j < i; j++) {
      var prev = cfg.mqttTopicsLinks[j];
      var samePair =
        (link.mqttTopicA === prev.mqttTopicA &&
          link.mqttTopicB === prev.mqttTopicB) ||
        (link.mqttTopicA === prev.mqttTopicB &&
          link.mqttTopicB === prev.mqttTopicA);

      if (!samePair) continue;

      // Mixed inverted on the same pair: opposite writes to one
      // target, or infinite A→!B→A→… cascade. Always conflict.
      if (!!link.invertSourceValue !== !!prev.invertSourceValue) {
        log.error(
          'Link [{}]: conflicts with link [{}] on the same pair' +
            ' — mixed invertSourceValue flags ("{}" and "{}")',
          i,
          j,
          link.mqttTopicA,
          link.mqttTopicB
        );
        return false;
      }

      // When A/B are swapped, forward/backward are inverted
      var existingDir = prev.direction;
      if (
        existingDir !== 'both' &&
        link.mqttTopicA === prev.mqttTopicB &&
        link.mqttTopicB === prev.mqttTopicA
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
      } else if (link.direction === 'both') {
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
      } else if (link.direction === existingDir) {
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

    // Type mismatch check
    if (typeA && typeB && typeA !== typeB) {
      log.warning(
        'Link [{}]: type mismatch: "{}" ({}) and "{}" ({})',
        i,
        link.mqttTopicA,
        typeA,
        link.mqttTopicB,
        typeB
      );
      this.ctx.hasIncorrectLinks = true;
    }

    var minA = dev[link.mqttTopicA + '#min'];
    var maxA = dev[link.mqttTopicA + '#max'];
    var minB = dev[link.mqttTopicB + '#min'];
    var maxB = dev[link.mqttTopicB + '#max'];

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
          link.mqttTopicA,
          minA,
          maxA,
          link.mqttTopicB,
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
    var link = mqttTopicsLinks[i];
    var invertSourceValue = link.invertSourceValue === true;

    if (link.direction === 'forward') {
      addToMap(map, link.mqttTopicA, link.mqttTopicB, invertSourceValue);
    } else if (link.direction === 'backward') {
      addToMap(map, link.mqttTopicB, link.mqttTopicA, invertSourceValue);
    } else if (link.direction === 'both') {
      addToMap(map, link.mqttTopicA, link.mqttTopicB, invertSourceValue);
      addToMap(map, link.mqttTopicB, link.mqttTopicA, invertSourceValue);
    }
  }
  return map;
}

/**
 * Adds a mapping from source to target in the map, avoiding duplicates
 * @param {SourceMap} map - The map to modify
 * @param {string} source - Source MQTT topic
 * @param {string} target - Target MQTT topic
 * @param {boolean} invertSourceValue - Whether to invert boolean value before write
 */
function addToMap(map, source, target, invertSourceValue) {
  if (!map[source]) {
    map[source] = [];
  }
  for (var i = 0; i < map[source].length; i++) {
    if (map[source][i].target === target) {
      return;
    }
  }
  map[source].push({ target: target, invertSourceValue: invertSourceValue });
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
 * Coerces a value to boolean with Wiren Board MQTT semantics.
 * In JS Boolean('false') and Boolean('0') return true (any non-empty
 * string is truthy), which violates the convention — handle explicitly.
 *
 * @param {*} value - Value to coerce
 * @returns {boolean} Coerced boolean
 */
function toBool(value) {
  if (typeof value === 'string') {
    var lower = value.toLowerCase();
    if (lower === 'false' || lower === '0') return false;
  }
  return Boolean(value);
}

/**
 * Converts a value to match the target control's type
 * according to ES5 coercion rules and Wiren Board MQTT Conventions.
 *
 * @param {*} value - Value to convert
 * @param {string} targetType - Target control type from meta
 * @param {boolean} [invertSourceValue] - If true and target is boolean,
 *   invert the result. Ignored for non-boolean target types
 *   (validateCfg already rejects inverted links with non-boolean targets).
 * @returns {*} Converted value
 */
function convertValueForType(value, targetType, invertSourceValue) {
  if (BOOL_CTRL_TYPES.indexOf(targetType) !== -1) {
    var b = toBool(value);
    return invertSourceValue ? !b : b;
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
        var entry = targets[i];
        var target = entry.target;
        var invertSourceValue = entry.invertSourceValue;
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
          var convertedValue = convertValueForType(
            newValue,
            targetType,
            invertSourceValue
          );
          if (dev[target] !== convertedValue) {
            dev[target] = convertedValue;
            log.debug(
              'Source "{}" (type "{}") value "{}" converted to "{}"' +
                '{} written to target "{}" (type "{}")',
              source,
              sourceType,
              newValue,
              convertedValue,
              invertSourceValue ? ' (Inverted)' : '',
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
