@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem ===========================================================================
rem Bili Live API Bridge - Windows launcher
rem
rem Usage:
rem   scripts\start-bili-bridge.cmd [--live^|--mock] [--port 61611] [--host 127.0.0.1] [--no-open]
rem
rem Behavior:
rem   1. Checks Node.js 20+ and installs dependencies with "npm ci" when needed.
rem   2. Probes http://127.0.0.1:61611/api/health.
rem      - If the bridge is already running, only opens the WebUI.
rem      - Otherwise starts "npm start" and passes all arguments through.
rem   3. Closing the console window stops the bridge.
rem
rem Desktop shortcut:
rem   Run scripts\create-desktop-shortcut.cmd, or create a .lnk manually.
rem   PowerShell snippet (replace $repo with the absolute repo path):
rem
rem     $repo = 'C:\path\to\bili-live-api-bridge'
rem     $desktop = [Environment]::GetFolderPath('Desktop')
rem     $ws = New-Object -ComObject WScript.Shell
rem     $lnk = $ws.CreateShortcut((Join-Path $desktop 'Bili Live Bridge.lnk'))
rem     $lnk.TargetPath = Join-Path $repo 'scripts\start-bili-bridge.cmd'
rem     $lnk.WorkingDirectory = $repo
rem     $lnk.WindowStyle = 1
rem     $lnk.IconLocation = Join-Path $repo 'web\app-icon.ico'
rem     $lnk.Description = 'Start Bili Live API Bridge WebUI'
rem     $lnk.Save()
rem ===========================================================================

cd /d "%~dp0.."

set "PORT=61611"
set "HOST=127.0.0.1"
set "OPEN_BROWSER=1"

call :parse_args %*

set "WEB_HOST=%HOST%"
if /I "%HOST%"=="0.0.0.0" set "WEB_HOST=127.0.0.1"
if "%HOST%"=="::" set "WEB_HOST=[::1]"
if "%HOST%"=="[::]" set "WEB_HOST=[::1]"
set "WEB_URL=http://%WEB_HOST%:%PORT%"
set "HEALTH_URL=%WEB_URL%/api/health"

title Bili Live Bridge - %PORT%

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH.
    echo Install Node.js 20 or newer: https://nodejs.org/
    pause
    exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm was not found in PATH.
    echo Reinstall Node.js and make sure npm is included.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR (
    echo [ERROR] Unable to read the Node.js version.
    pause
    exit /b 1
)
if %NODE_MAJOR% LSS 20 (
    echo [ERROR] Node.js 20 or newer is required. Current major version: %NODE_MAJOR%
    pause
    exit /b 1
)

if not exist "node_modules\tsx" (
    echo Installing dependencies with npm ci...
    call npm ci
    if errorlevel 1 (
        echo [ERROR] npm ci failed.
        pause
        exit /b 1
    )
)

call :is_running
if "%RUNNING%"=="1" (
    echo Bili Live Bridge is already running.
    if "%OPEN_BROWSER%"=="1" (
        start "" "%WEB_URL%"
    ) else (
        echo WebUI URL: %WEB_URL%
    )
    exit /b 0
)

echo Starting Bili Live Bridge on %WEB_URL%
call npm start -- %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
    echo [ERROR] Bili Live Bridge exited with code %EXIT_CODE%.
    pause
)
exit /b %EXIT_CODE%

:is_running
set "RUNNING=0"
where curl.exe >nul 2>&1
if not errorlevel 1 (
    curl.exe -fsS --max-time 2 "%HEALTH_URL%" >nul 2>&1
    if not errorlevel 1 set "RUNNING=1"
    exit /b 0
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri '%HEALTH_URL%'; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 set "RUNNING=1"
exit /b 0

:parse_args
if "%~1"=="" exit /b 0
if /I "%~1"=="--port" goto parse_port
if /I "%~1"=="--host" goto parse_host
if /I "%~1"=="--no-open" (
    set "OPEN_BROWSER=0"
    shift
    goto parse_args
)
set "ARG=%~1"
if /I "%ARG:~0,7%"=="--port=" (
    set "PORT=%ARG:~7%"
    shift
    goto parse_args
)
if /I "%ARG:~0,7%"=="--host=" (
    set "HOST=%ARG:~7%"
    shift
    goto parse_args
)
shift
goto parse_args

:parse_port
if "%~2"=="" exit /b 0
set "PORT=%~2"
shift
shift
goto parse_args

:parse_host
if "%~2"=="" exit /b 0
set "HOST=%~2"
shift
shift
goto parse_args
