@echo off
cd /d "%~dp0"
echo 正在启动本机转发...
python serve.py
if errorlevel 1 py -3 serve.py
pause
