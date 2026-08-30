@echo off
chcp 65001 >nul
cd /d C:\OmniRoute\voice-agents\desktop
if not exist "node_modules\.bin\electron.cmd" (
  echo  [DESKTOP] Electron wird installiert (einmalig)...
  call npm install --no-fund --no-audit
)
echo  [DESKTOP] Starte OmniRoute Control Room Shell...
call npx electron .
