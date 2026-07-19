@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist "%~dp0scripts\install_daily_automation.ps1" (
  echo 缺少 scripts\install_daily_automation.ps1，无法安装每日任务。
  pause
  exit /b 2
)
if not exist "%~dp0.codex\portable-automation-prompt.txt" (
  echo 缺少 .codex\portable-automation-prompt.txt，无法安装每日任务。
  pause
  exit /b 2
)
if not exist "%~dp0.codex\atlas-maintenance-state.json" (
  echo 缺少 .codex\atlas-maintenance-state.json，无法续做真实 pending。
  pause
  exit /b 2
)

echo 即将为当前解压目录安装 Atlas 每日北京时间 04:00 完整优化任务。
echo 任务会维护 11 个正式页面、站内公开全文阅读、学术追踪三视图和待审核候选；不会自动把候选合并进权威数据。
echo.
if defined CODEX_HOME (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install_daily_automation.ps1" -ProjectRoot "%~dp0." -CodexHome "%CODEX_HOME%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install_daily_automation.ps1" -ProjectRoot "%~dp0."
)
if errorlevel 1 (
  echo.
  echo 安装失败。请确认已经安装、登录并启动过 Codex Desktop。
  pause
  exit /b 1
)

echo.
echo 配置已写入。请完全退出并重启 Codex Desktop，再在“自动化”页面核对安装器显示的本地时间确实对应北京时间 04:00。
echo 未在目标电脑完成上述人工确认前，不得把自动化标为已验证。
pause
