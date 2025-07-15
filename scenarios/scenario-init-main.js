var DevicesControlSetup = require("init-devices-control.mod").setup;
var LightControlSetup = require("scenario-init-light-control.mod").setup;
var ThermostatSetup = require("scenario-init-thermostat.mod").setup;
var Logger = require('logger.mod').Logger;

function main() {
  log.debug('Start initialisation all types scenarios');
  DevicesControlSetup();
  LightControlSetup();
  ThermostatSetup();
}

main();