@echo off
rem ============================================================
rem  Control-Room UI-Test (CI-artig): faehrt den Server selbst
rem  hoch und fuehrt den Playwright-Test headless aus.
rem  Nutzung: ui\tests\run_ui_test.cmd [port]
rem ============================================================
chcp 65001 >nul
setlocal
set PORT=%1
if "%PORT%"=="" set PORT=20139
set ROOT=C:\OmniRoute\voice-agents
set SKILL=C:\Users\Sebastian\.agents\skills\webapp-testing
set PY=%ROOT%\.venv\Scripts\python.exe

rem Verwaiste Server auf dem Zielport beenden (Windows zeigt LISTEN als "ABHOEREN")
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr /i "ABH"') do (
  echo [ui-test] Verwaisten Prozess %%p auf Port %PORT% beenden ...
  taskkill /F /PID %%p >nul 2>&1
)
"%SystemRoot%\System32\timeout.exe" /t 1 /nobreak >nul

echo [ui-test] Server auf Port %PORT% starten ...
"%PY%" "%SKILL%\scripts\with_server.py" ^
  --server "cd /d %ROOT% && %PY% -m uvicorn ui.main:app --host 0.0.0.0 --port %PORT%" ^
  --port %PORT% ^
  --timeout 40 ^
  -- %PY% "%ROOT%\ui\tests\run_test_with_base.py" "http://127.0.0.1:%PORT%/"
set EXIT=%ERRORLEVEL%
echo [ui-test] Exit-Code: %EXIT%
exit /b %EXIT%
