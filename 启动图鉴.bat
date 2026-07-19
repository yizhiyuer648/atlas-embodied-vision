@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "LAN_IP="
for /f %%I in ('powershell -NoProfile -Command "$ip=(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress; if ($ip) { $ip }"') do set "LAN_IP=%%I"

where py >nul 2>nul
if %errorlevel%==0 (
  start "Atlas static server" /min py -m http.server 8000 --bind 0.0.0.0
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo [Atlas] 未找到 Python，请先安装 Python 3。
    pause
    exit /b 1
  )
  start "Atlas static server" /min python -m http.server 8000 --bind 0.0.0.0
)
timeout /t 1 /nobreak >nul
echo.
echo [Atlas] 本机访问：http://127.0.0.1:8000/index.html
if defined LAN_IP (
  echo [Atlas] 手机访问：http://%LAN_IP%:8000/index.html
  echo [Atlas] 手机需与电脑连接同一 Wi-Fi；若无法打开，请允许 Python 通过 Windows 防火墙。
) else (
  echo [Atlas] 未检测到局域网 IPv4 地址；请在 ipconfig 中查找 Wi-Fi 的 IPv4 地址。
)
echo.
start "" http://127.0.0.1:8000/index.html
