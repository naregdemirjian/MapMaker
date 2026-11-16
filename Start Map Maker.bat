@echo off
title Map Maker
cd /d "%~dp0"

where node >nul 2>nul || goto nonode
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" || goto oldnode

echo.
echo  Starting Map Maker. Your browser will open in a moment.
echo  Keep this window open while you work. Close it to quit.
echo.
node --disable-warning=ExperimentalWarning "dist\server.mjs" --open
echo.
echo  Map Maker has stopped.
pause
exit /b 0

:nonode
echo.
echo  Map Maker needs Node.js, which is not installed on this computer.
echo  Your browser will now open the Node.js download page.
echo  Download the version marked LTS, run the installer with its normal options,
echo  then double-click "Start Map Maker" again.
echo.
start "" "https://nodejs.org/en/download"
pause
exit /b 1

:oldnode
echo.
echo  Map Maker needs Node.js 22.13 or newer. This computer has:
node --version
echo  Your browser will now open the Node.js download page.
echo  Install the version marked LTS, then double-click "Start Map Maker" again.
echo.
start "" "https://nodejs.org/en/download"
pause
exit /b 1
