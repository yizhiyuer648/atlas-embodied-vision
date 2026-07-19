@echo off
setlocal
chcp 65001 >nul

set "RULE_NAME=Atlas local web (TCP 8000)"

powershell -NoProfile -Command "if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo 正在请求管理员权限，只用于开放本地子网访问 TCP 8000...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$name='%RULE_NAME%';" ^
  "$rule=Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue;" ^
  "if($rule){$rule|Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Public,Private}" ^
  "else{New-NetFirewallRule -DisplayName $name -Description 'Allow Atlas static site from devices on the local subnet only.' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -RemoteAddress LocalSubnet -Profile Public,Private|Out-Null};" ^
  "$rule=Get-NetFirewallRule -DisplayName $name;" ^
  "$port=Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule;" ^
  "$address=Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule;" ^
  "Write-Host ('已启用：'+$rule.DisplayName);" ^
  "Write-Host ('端口：'+$port.LocalPort+'，来源：'+($address.RemoteAddress -join ','))"

if errorlevel 1 (
  echo.
  echo 防火墙规则创建失败，请保留本窗口中的错误信息。
) else (
  echo.
  echo 完成。现在先双击“启动图鉴.bat”，再让手机连接同一 Wi-Fi。
  echo 手机访问地址请看启动窗口中显示的局域网 IPv4。
)
pause

