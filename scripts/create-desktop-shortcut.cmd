@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem ===========================================================================
rem Bili Live API Bridge - create a Windows desktop shortcut
rem
rem Creates "Bili Live Bridge.lnk" on the current user's Desktop.
rem The shortcut targets scripts\start-bili-bridge.cmd and uses web\app-icon.ico
rem as its icon (falling back to node.exe). Run this file directly, no
rem arguments are required.
rem
rem For other Windows machines, copy the repository anywhere and run this
rem script; paths are resolved relative to the script location, so no drive
rem letters are hard-coded.
rem ===========================================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $repo = Split-Path -Parent (Split-Path -Parent '%~f0'); $target = Join-Path $repo 'scripts\start-bili-bridge.cmd'; if (-not (Test-Path -LiteralPath $target)) { throw ('Launcher not found: ' + $target) }; $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Bili Live Bridge.lnk'; $ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut($shortcutPath); $lnk.TargetPath = $target; $lnk.WorkingDirectory = $repo; $lnk.WindowStyle = 1; $lnk.Description = 'Start Bili Live API Bridge WebUI'; $icon = Join-Path $repo 'web\app-icon.ico'; if (Test-Path -LiteralPath $icon) { $lnk.IconLocation = $icon + ',0' } else { $node = Get-Command node.exe -ErrorAction SilentlyContinue; if ($node) { $lnk.IconLocation = $node.Source + ',0' } }; $lnk.Save(); Write-Host ('Created desktop shortcut: ' + $shortcutPath)"
if errorlevel 1 (
    echo [ERROR] Failed to create the desktop shortcut.
    pause
    exit /b 1
)

echo Done.
exit /b 0
