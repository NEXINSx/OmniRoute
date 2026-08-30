@echo off
setlocal
set "AGENTS=C:\OmniRoute\voice-agents"
set "PY=%AGENTS%\.venv\Scripts\python.exe"
cd /d "%AGENTS%"
"%PY%" scripts\stack_orchestrator.py --start
set "EXITCODE=%ERRORLEVEL%"
echo.
echo  Detaillierter Status: "%AGENTS%\status.cmd"
endlocal & exit /b %EXITCODE%
