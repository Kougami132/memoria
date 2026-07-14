#requires -Version 5.1
<#
.SYNOPSIS
  Win11 通知 —— 需确认 / 需权限时触发。
  被 detached spawn 调用。Start-Process 启动独立子进程保活跑 BurntToast。
.PARAMETER Body
#>
param(
    [string]$Body = "AI 需要你确认操作"
)

$null = [Console]::In.ReadToEnd()

$escB = $Body -replace "'", "''"

try {
    Start-Process pwsh -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"Import-Module BurntToast -ErrorAction Stop; New-BurntToastNotification -Text '需确认', '$escB'; Start-Sleep -Milliseconds 1500`"" -WindowStyle Normal
} catch {}
