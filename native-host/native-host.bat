@echo off
REM pi-browser-control native host launcher.
REM Chrome ignores the "args" field of native host manifests, so this
REM wrapper carries the script path instead.
"%ProgramFiles%\nodejs\node.exe" "%~dp0native-host.mjs" %*
