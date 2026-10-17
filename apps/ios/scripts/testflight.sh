#!/bin/sh
# Archives a Release build (app + widgets) and uploads it to App Store Connect
# for TestFlight (RUNBOOK.md, "TestFlight"). Uses the Apple account signed in to
# Xcode, so run it from your own terminal, not a sandboxed one.
#
#   apps/ios/scripts/testflight.sh            # archive and upload
#   UPLOAD=0 apps/ios/scripts/testflight.sh   # archive and export an .ipa only
#   ARCHIVE=build/Dishes-<build>.xcarchive apps/ios/scripts/testflight.sh   # upload an existing archive
#
# The build number is the time (yyyymmddHHMM), so every upload is newer than the last.
set -eu
cd "$(dirname "$0")/.."
mkdir -p build
if [ -n "${ARCHIVE:-}" ]; then
  BUILD=$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleVersion' "$ARCHIVE/Info.plist")
  SKIP_ARCHIVE=1
else
  BUILD=${BUILD:-$(date -u +%Y%m%d%H%M)}
  ARCHIVE=build/Dishes-$BUILD.xcarchive
fi
DESTINATION=$([ "${UPLOAD:-1}" = 1 ] && echo upload || echo export)

if [ -z "${SKIP_ARCHIVE:-}" ]; then
xcodegen generate
xcodebuild -project Dishes.xcodeproj -scheme Dishes -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" archive -quiet
fi

cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DESTINATION</string>
  <key>teamID</key><string>C729B84RYG</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist build/ExportOptions.plist \
  -exportPath build/export-$BUILD -allowProvisioningUpdates
echo "Build $BUILD: $DESTINATION done."
