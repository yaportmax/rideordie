#!/bin/bash
# usage: run.sh <script.py> [args]   -> runs a structure script in Blender headless (prints EXPORTED lines + errors)
cd /c/Dev/rideordie
"C:/Dev/tools/Blender-4.5.11-portable/blender.exe" -b --factory-startup -P "tools/blender/structures/$1" -- "${@:2}" 2>&1 | grep -E "EXPORTED|Error|error|Traceback|File \"|raise|Exception|WARN|print:" | grep -v "Draco"
