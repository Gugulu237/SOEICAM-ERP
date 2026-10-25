@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-local-preview.ps1"
if errorlevel 1 pause
