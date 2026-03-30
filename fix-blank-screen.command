#!/bin/bash
echo ""
echo "Fixing Yogi Browser..."
xattr -rd com.apple.quarantine "/Applications/Yogi Browser.app" 2>/dev/null
echo "Done! Opening Yogi Browser now..."
sleep 1
open "/Applications/Yogi Browser.app"
