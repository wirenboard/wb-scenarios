#!/bin/bash
# wb-scenarios-toucher.sh - must be install to /usr/lib/wb-scenarios/*
#
# Script to update timestamps of scenario initialization files in $FILES array
# Used to trigger scenarios reinitialization without restarting wb-rules.
#
# Usage:
#   $ ./wb-scenarios-toucher.sh [-v]
#       -v  Enable verbose mode for debugging
#
# NOTE: Used by the wb-scenarios-toucher service which is referenced
#   in the wb-scenarios JSON schema. This enables a more gentle, targeted
#   restart of wb-scenarios initialization scripts, as opposed to a hard
#   restart of the entire wb-rules service. Designed to be used as a oneshot
#   systemd service which fixes non-removable virtual devices when directly
#   rebooting the 'wb-rules' service (SOFT-4722).

# List of files to update
BASE_DIR="/usr/share/wb-rules-system/rules"
FILES=(
  "${BASE_DIR}/init-devices-control.js"
  "${BASE_DIR}/scenario-init-light-control.js"
  "${BASE_DIR}/scenario-init-thermostat.js"
  # Add other files here as needed
)

# Status codes
SUCCESS=0
ERROR=1
INVALID_OPTION=1
FILE_NOT_FOUND=1
FILE_PROCESS_FAILED=1

# Flag for verbose mode
VERBOSE=false

# Prints a timestamped message to stdout if verbose mode is enabled.
# Arguments:
#   $1 Message to log
log() {
  local msg=$1

  if [ "$VERBOSE" = true ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $msg"
  fi
}

# Updates the file's modification timestamp.
# Arguments:
#   $1 File path to update
# Returns:
#   0 on success, 1 on failure
touch_file() {
  local file=$1
  
  # Early return if file doesn't exist
  if [ ! -f "$file" ]; then
    log "ERROR: File does not exist: $file"
    return 1  # Failure
  fi
  
  # Update file timestamp
  touch "$file"
  log "Successfully updated timestamp for file: $file"
  
  return 0  # Success
}

# Parses command line arguments and processes each file in the FILES array.
# Arguments:
#   Command line arguments (see getopts)
# Returns:
#   0 on success
#   non-zero on failure
main() {
  local process_result=0
  
  # Parse command line arguments
  while getopts "v" opt; do
    case $opt in
      v)
        VERBOSE=true
        log "Verbose mode enabled"
        ;;
      \?)
        log "Invalid option: -$OPTARG"
        exit 1  # Invalid option
        ;;
    esac
  done
  
  log "Starting file timestamp update service"
  
  # Process each file in the list
  for file in "${FILES[@]}"; do
    process_result=$(touch_file "$file"; echo $?)
    if [ $process_result -ne 0 ]; then
      # Exit on first file processing error
      exit 1  # File processing failed
    fi
  done
  
  log "Service completed successfully"
  return 0  # Success
}

main "$@"
exit $?
