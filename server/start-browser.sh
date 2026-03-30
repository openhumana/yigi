#!/bin/sh
# Start the browser server with correct LD_LIBRARY_PATH for Playwright Chromium
# mesa-libgbm provides libgbm.so.1 which Chromium needs
MESA_GBM=/nix/store/24w3s75aa2lrvvxsybficn8y3zxd27kp-mesa-libgbm-25.1.0/lib
export LD_LIBRARY_PATH="$MESA_GBM:$REPLIT_LD_LIBRARY_PATH:$LD_LIBRARY_PATH"
exec node server/browser.js
