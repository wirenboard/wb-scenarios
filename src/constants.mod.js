/**
 * @file constants.mod.js - Shared constants for scenarios
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var DAY_NAMES = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};
var DAY_NAME_TO_NUMBER = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};
var VALID_DAYS = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
];
var FULL_DAYS = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
];
var MS_PER_SECOND = 1000;
var MS_PER_MINUTE = 60000;
var MS_PER_HOUR = MS_PER_MINUTE * 60;

exports.DAY_NAMES = DAY_NAMES;
exports.DAY_NAME_TO_NUMBER = DAY_NAME_TO_NUMBER;
exports.VALID_DAYS = VALID_DAYS;
exports.FULL_DAYS = FULL_DAYS;
exports.MS_PER_SECOND = MS_PER_SECOND;
exports.MS_PER_MINUTE = MS_PER_MINUTE;
exports.MS_PER_HOUR = MS_PER_HOUR;
