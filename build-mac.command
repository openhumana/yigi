#!/bin/bash
# Yogi Browser — Mac Builder
# Double-click this file to build the Mac app

cd "$(dirname "$0")"

echo ""
echo "====================================="
echo "  Yogi Browser — Mac App Builder"
echo "====================================="
echo ""

# Check for Node.js
if ! command -v node &>/dev/null; then
  echo "❌ Node.js is not installed."
  echo ""
  echo "Please install it first:"
  echo "  1. Go to https://nodejs.org"
  echo "  2. Click the big green Download button"
  echo "  3. Install it (click through the steps)"
  echo "  4. Then double-click this file again"
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo ""

# Ask for Groq API key
echo "Your Groq API key will be embedded into the app."
echo "Get one free at: https://console.groq.com"
echo ""
read -p "Paste your Groq API key (starts with gsk_): " GROQ_KEY

if [ -z "$GROQ_KEY" ]; then
  echo ""
  echo "⚠️  No key entered. Building without pre-loaded key."
  echo "   Users will see the setup screen on first launch."
fi
echo ""

# Install dependencies
echo "📦 Installing dependencies (this takes 1-2 minutes first time)..."
npm install --silent
if [ $? -ne 0 ]; then
  echo "❌ Dependency install failed. Check your internet connection."
  read -p "Press Enter to close..."
  exit 1
fi
echo "✅ Dependencies ready"
echo ""

# Build the app
echo "🔨 Building Yogi Browser for Mac..."
echo "   (This takes 2-5 minutes)"
echo ""
DEFAULT_GROQ_KEY="$GROQ_KEY" npm run electron:build:mac
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Build failed. Please copy the error above and share it."
  read -p "Press Enter to close..."
  exit 1
fi

echo ""
echo "====================================="
echo "  ✅ Build Complete!"
echo "====================================="
echo ""
echo "Your app is in the 'build' folder."
echo "Look for: YogiBrowser-Mac-1.0.0-*.zip"
echo ""
echo "To install:"
echo "  1. Open the 'build' folder (opening now...)"
echo "  2. Double-click the .zip file to extract it"
echo "  3. Move 'Yogi Browser.app' to your Applications folder"
echo "  4. Right-click it → Open → Open (to bypass Mac security)"
echo ""

# Open the build folder
open build/ 2>/dev/null || true

read -p "Press Enter to close..."
