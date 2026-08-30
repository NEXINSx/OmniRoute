@echo off
setlocal
set "AGENTS=C:\OmniRoute\voice-agents"
set "PY=%AGENTS%\.venv\Scripts\python.exe"
cd /d "%AGENTS%"
echo.
echo ============================================================
echo  OmniRoute Voice Agents - Dienststatus
echo  %DATE% %TIME%
echo ============================================================
echo.
"%PY%" scripts\stack_orchestrator.py --status
set "EXITCODE=%ERRORLEVEL%"
echo.
echo  Tailscale:  http://100.73.183.117:3000  (Playground)
echo              http://100.73.183.117:4096  (opencode web)
echo              http://100.73.183.117:8188  (ComfyUI)
endlocal & exit /b %EXITCODE%
