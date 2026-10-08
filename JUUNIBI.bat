@echo off
setlocal EnableExtensions
chcp 65001 >nul
title JUUNIBI
rem Portable launcher: works from any drive (USB, network share, folder). Pass-through args: --dev --no-open --skip-checks --port N

pushd "%~dp0" 2>nul || (echo [ОШИБКА] Не удалось открыть папку программы. & pause & exit /b 1)

set "RUNTIME=%CD%\.runtime"
set "NODE_DIR=%RUNTIME%\node"

rem 1) Node.js: system -> portable in .runtime -> download
call :check_node
if not errorlevel 1 goto have_node
if exist "%NODE_DIR%\node.exe" (
  set "PATH=%NODE_DIR%;%PATH%"
  call :check_node
  if not errorlevel 1 goto have_node
)

echo Node.js 20+ не найден. Скачиваю переносную версию в "%RUNTIME%" ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\bootstrap-node.ps1" -Dest "%RUNTIME%"
if errorlevel 1 goto fail_node
set "PATH=%NODE_DIR%;%PATH%"
call :check_node
if errorlevel 1 goto fail_node

:have_node
for /f %%v in ('node -v') do echo Node.js %%v
rem 2) Install, typecheck, tests, build, free port, serve, open browser
node "%CD%\scripts\launch.mjs" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [ОШИБКА] Запуск завершился с кодом %RC%.
  popd
  pause
  exit /b %RC%
)
popd
exit /b 0

:fail_node
echo.
echo [ОШИБКА] Не удалось получить Node.js. Проверьте интернет или установите с https://nodejs.org
popd
pause
exit /b 1

:check_node
node -e "process.exit(+process.versions.node.split('.')[0]>=20?0:1)" >nul 2>&1
exit /b %ERRORLEVEL%
