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
#
# Signing and upload use an App Store Connect API key when there is one, so they
# don't depend on the account signed in to Xcode (Xcode 27.1 stopped sharing
# that with xcodebuild — RUNBOOK.md, "TestFlight"). Put the key at
# ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8 and its ids in
# ~/.appstoreconnect/dishes.env:
#
#   ASC_KEY_ID=ABC123DEFG
#   ASC_ISSUER_ID=00000000-0000-0000-0000-000000000000
#
# Without them it falls back to Xcode's account.
set -eu
cd "$(dirname "$0")/.."
# Xcode's export copies with whichever rsync comes first; Homebrew's 3.x breaks
# it ("Copy failed", rsync "syntax or usage error"), so the system tools go first.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
mkdir -p build
[ -f "$HOME/.appstoreconnect/dishes.env" ] && . "$HOME/.appstoreconnect/dishes.env"
AUTH=""
if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ]; then
  KEY=${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}
  [ -f "$KEY" ] || { echo "No API key at $KEY" >&2; exit 1; }
  AUTH="-authenticationKeyPath $KEY -authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID"
  echo "Signing with App Store Connect API key $ASC_KEY_ID"
fi
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
  -allowProvisioningUpdates $AUTH CURRENT_PROJECT_VERSION="$BUILD" archive -quiet
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
  -exportPath build/export-$BUILD -allowProvisioningUpdates $AUTH
echo "Build $BUILD: $DESTINATION done."
