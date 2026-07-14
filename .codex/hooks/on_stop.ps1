#requires -Version 5.1
<#
.SYNOPSIS
  Win11 通知 —— 对话轮结束触发。
  BurntToast 主(默认 AppID 已验证能弹);WinRT+WT AppID 降级。
  被 spawnSync 同步调用。BurntToast Show() 同步完成,即使后续被 SIGTERM toast 已弹。
.PARAMETER Title
.PARAMETER Body
#>
param(
    [string]$Title = "对话完成",
    [string]$Body  = "AI 已完成本轮回复"
)

$null = [Console]::In.ReadToEnd()

function Show-Toast {
    param([string]$T, [string]$B)
    # 1. BurntToast(默认 AppID 已验证能弹)
    try {
        Import-Module BurntToast -ErrorAction Stop
        New-BurntToastNotification -Text $T, $B
        Start-Sleep -Milliseconds 1500
        return
    } catch {}
    # 2. WinRT + Windows Terminal AppID
    try {
        [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
        [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
        $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $xml.GetElementsByTagName("text")
        $nodes[0].AppendChild($xml.CreateTextNode($T)) | Out-Null
        $nodes[1].AppendChild($xml.CreateTextNode($B)) | Out-Null
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Microsoft.WindowsTerminal_8wekyb3d8bbwe!App").Show($toast)
        Start-Sleep -Milliseconds 2000
    } catch {}
}

Show-Toast -T $Title -B $Body
