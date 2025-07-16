/**
 * @file scenario-init-main.js - ES5 script for wb-rules v2.34
 * @description Main initialization script for WB scenarios management
 *     This script performs:
 *     - Cleanup of previous MQTT retained messages for virtual devices
 *     - Sequential initialization of:
 *       * Devices control scenarios
 *       * Light control scenarios
 *       * Thermostat scenarios
 *     - Persistent storage reset for scenario devices
 *
 * @author Mikhail Burchu <mikhail.burchu@wirenboard.com>
 */

var DevicesControlSetup = require("scenario-init-devices-control.mod").setup;
var LightControlSetup = require("scenario-init-light-control.mod").setup;
var ThermostatSetup = require("scenario-init-thermostat.mod").setup;
var Logger = require('logger.mod').Logger;

function main() {
  log.debug('Start initialisation all types scenarios');

  // Retrieving all previously created virtual devices from persistent storage
  var psWBSC = new PersistentStorage("wb-scenarios", {global: true});
  var cmdList = '';
  if (psWBSC["VdList"] !== undefined) {
    var VdList = Object.keys(psWBSC["VdList"]);
    VdList.forEach(function(Vdevice) {
      cmdList = cmdList + 'mqtt-delete-retained /devices/' + Vdevice + '/# > /dev/null 2>&1;'
    });
  }

  runShellCommand(cmdList, { //Removing all previously created virtual devices from topics
    captureOutput: true,
    captureErrorOutput: true,
    exitCallback: function (exitCode, capturedOutput, capturedErrorOutput) {
      DevicesControlSetup();
      LightControlSetup();
      ThermostatSetup();
    }
  });
  psWBSC["VdList"] = null; // Removing all previously created virtual devices from persistent storage
}

main();
