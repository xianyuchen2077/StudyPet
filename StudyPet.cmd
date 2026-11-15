@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
pushd "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is missing. Run npm install in this folder first.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "." --study-demo
popd
endlocal
