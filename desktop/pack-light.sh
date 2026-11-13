#!/bin/sh
# Builds the light (Neutralino) app: dist/light/Bridgys-Farm-Light.exe and .dmg.
# First time only: npx -y @neutralinojs/neu@11.8.0 update   (downloads the runtimes into bin/)
set -e
cd "$(dirname "$0")"
OUT=dist/light; APP="$OUT/Bridgy's Farm Light.app"; TMP=.pack
rm -rf "$OUT" "$TMP"; mkdir -p "$OUT" "$APP/Contents/MacOS" "$APP/Contents/Resources" "$TMP/icon.iconset"

npx -y @neutralinojs/neu@11.8.0 build --embed-resources
cp dist/bridgys-farm/bridgys-farm-win_x64.exe "$OUT/Bridgys-Farm-Light.exe"

for s in 16 32 128 256 512; do
  sips -z $s $s web/icon.png --out "$TMP/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) web/icon.png --out "$TMP/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/icon.iconset" -o "$APP/Contents/Resources/icon.icns"
cp dist/bridgys-farm/bridgys-farm-mac_universal "$APP/Contents/MacOS/bridgys-farm"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Bridgy's Farm Light</string>
  <key>CFBundleDisplayName</key><string>Bridgy's Farm Light</string>
  <key>CFBundleIdentifier</key><string>am.programmingschool.bridgysfarm.light</string>
  <key>CFBundleExecutable</key><string>bridgys-farm</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.education</string>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
# the embedded game page changes the binary, so it needs a fresh (free, local) signature or macOS kills it
codesign --force --deep -s - "$APP"

mkdir "$TMP/dmg"; cp -R "$APP" "$TMP/dmg/"; ln -s /Applications "$TMP/dmg/Applications"
hdiutil create -volname "Bridgy's Farm Light" -srcfolder "$TMP/dmg" -ov -format UDZO "$OUT/Bridgys-Farm-Light.dmg" >/dev/null
rm -rf "$TMP" dist/bridgys-farm
ls -lh "$OUT"
