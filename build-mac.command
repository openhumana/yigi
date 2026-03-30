#!/bin/bash
cd "$(dirname "$0")"

clear
echo "======================================"
echo "   Yogi Browser — Mac App Builder"
echo "======================================"
echo ""

# ── Check Node.js ──────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "❌  Node.js is not installed."
  echo ""
  echo "    1. Open Safari and go to:  nodejs.org"
  echo "    2. Click the green Download button"
  echo "    3. Open the downloaded file and click through the installer"
  echo "    4. Come back and double-click this file again"
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi
echo "✅  Node.js ready  ($(node --version))"
echo ""

# ── Groq API Key ───────────────────────────────────────────
echo "Enter your Groq API key below."
echo "It starts with  gsk_"
echo "(Get one free at https://console.groq.com)"
echo ""
read -p "Groq API Key: " GROQ_KEY
echo ""

# ── Install packages ───────────────────────────────────────
echo "📦  Installing packages..."
npm install --silent 2>&1 | tail -3
echo "✅  Packages ready"
echo ""

# ── Clean stale build artifacts ────────────────────────────
echo "🧹  Cleaning old build cache..."
rm -rf dist dist-electron build node_modules/.cache
echo "✅  Clean done"
echo ""

# ── Build ──────────────────────────────────────────────────
echo "🔨  Building Yogi Browser..."
echo "    (Takes 3-5 minutes — please wait)"
echo ""
DEFAULT_GROQ_KEY="$GROQ_KEY" npm run electron:build:mac 2>&1
BUILD_STATUS=$?

if [ $BUILD_STATUS -ne 0 ]; then
  echo ""
  echo "❌  Build failed. Please screenshot this window and share it."
  read -p "Press Enter to close..."
  exit 1
fi

# ── Find the .app inside the zip ──────────────────────────
echo ""
echo "📂  Finding your app..."

ZIP=$(ls build/YogiBrowser-Mac-*arm64*.zip 2>/dev/null | head -1)
if [ -z "$ZIP" ]; then
  ZIP=$(ls build/YogiBrowser-Mac-*.zip 2>/dev/null | head -1)
fi

if [ -z "$ZIP" ]; then
  echo "❌  Could not find the built zip. Check the 'build' folder manually."
  open build/
  read -p "Press Enter to close..."
  exit 1
fi

echo "✅  Found: $ZIP"
echo ""

# ── Extract the zip ────────────────────────────────────────
rm -rf /tmp/yogi-install
mkdir -p /tmp/yogi-install
unzip -q "$ZIP" -d /tmp/yogi-install

APP=$(find /tmp/yogi-install -name "*.app" | head -1)
if [ -z "$APP" ]; then
  echo "❌  Could not extract the app."
  read -p "Press Enter to close..."
  exit 1
fi

# ── Install to Applications ────────────────────────────────
echo "🚀  Installing Yogi Browser to your Applications folder..."
rm -rf "/Applications/Yogi Browser.app"
cp -R "$APP" "/Applications/Yogi Browser.app"

if [ $? -eq 0 ]; then
  # Remove macOS quarantine so the app loads correctly (no blank screen)
  xattr -rd com.apple.quarantine "/Applications/Yogi Browser.app" 2>/dev/null || true

  echo ""
  echo "======================================"
  echo "  ✅  Yogi Browser is installed!"
  echo "======================================"
  echo ""
  echo "  HOW TO OPEN IT:"
  echo ""
  echo "  1. Your Applications folder is opening now"
  echo "  2. Find 'Yogi Browser' and double-click it"
  echo "  3. If a warning appears, click 'Open'"
  echo "  4. The app opens — you're ready!"
  echo ""
  # Open Applications so they can see it
  open /Applications
  # Launch the app directly
  sleep 1
  open "/Applications/Yogi Browser.app"
else
  echo ""
  echo "⚠️  Could not copy automatically."
  echo "    Opening your build folder instead..."
  open build/
fi

read -p "Press Enter to close this window..."
