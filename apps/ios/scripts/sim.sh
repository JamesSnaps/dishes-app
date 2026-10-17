#!/bin/sh
# Builds the app for the simulator, installs it on the booted one and opens it
# against a local dev server (Debug builds' Developer menu; RUNBOOK.md).
#
#   apps/ios/scripts/sim.sh                         # dev server http://localhost:3000
#   DEV_SERVER=http://localhost:3001 apps/ios/scripts/sim.sh
#   FRESH=1 apps/ios/scripts/sim.sh                 # uninstall first (empty database)
#   DEVICE=<udid or name> apps/ios/scripts/sim.sh   # a particular simulator (an iPad, say)
set -eu
# Signed ad hoc ("Sign to Run Locally"): the simulator's Keychain refuses an
# unsigned app, so CODE_SIGNING_ALLOWED=NO would lose the sign-in tokens.

cd "$(dirname "$0")/.."
BUNDLE=uk.collco.dishes
DEV_SERVER=${DEV_SERVER:-http://localhost:3000}
DERIVED=${DERIVED:-build/dd}
DEVICE=${DEVICE:-booted}

if [ ! -d Dishes.xcodeproj ] || [ project.yml -nt Dishes.xcodeproj ]; then xcodegen generate; fi

if [ "$DEVICE" = booted ]; then
  UDID=$(xcrun simctl list devices booted -j |
    python3 -c 'import json,sys; print(next(d["udid"] for r in json.load(sys.stdin)["devices"].values() for d in r))')
else
  # A UDID or a name ("iPad Pro 11-inch (M5)").
  UDID=$(xcrun simctl list devices available -j | DEVICE="$DEVICE" python3 -c '
import json, os, sys
want = os.environ["DEVICE"]
print(next(d["udid"] for r in json.load(sys.stdin)["devices"].values() for d in r if want in (d["udid"], d["name"])))')
  xcrun simctl boot "$UDID" 2>/dev/null || true
fi

xcodebuild -project Dishes.xcodeproj -scheme Dishes -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$DERIVED" build -quiet

xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
if [ "${FRESH:-}" = 1 ]; then xcrun simctl uninstall "$UDID" "$BUNDLE"; fi
xcrun simctl install "$UDID" "$DERIVED/Build/Products/Debug-iphonesimulator/Dishes.app"
xcrun simctl launch "$UDID" "$BUNDLE" -DishesDevServer "$DEV_SERVER" "$@"
