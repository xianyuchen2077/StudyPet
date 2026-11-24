# StudyPet foreground sampler (Windows).
# Long-running helper: prints one JSON line per sample to stdout:
#   {"pid":1234,"process":"chrome","title":"...","titleB64":"..."}
# title is also provided base64(UTF-8) so the parent never depends on the
# console code page for Chinese captions.
# Only the foreground window handle, owning process and caption are read.
# No screenshot, no keystrokes, no window content. The parent kills this
# process when monitoring is paused.
param([int]$IntervalMs = 2000)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class StudyPetForegroundWindow {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int maxCount);
}
'@

if ($IntervalMs -lt 500) { $IntervalMs = 500 }

while ($true) {
    $handle = [StudyPetForegroundWindow]::GetForegroundWindow()
    $processId = 0
    $title = ''
    if ($handle -ne [IntPtr]::Zero) {
        [uint32]$processId = 0
        [void][StudyPetForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
        $buffer = New-Object System.Text.StringBuilder 512
        $length = [StudyPetForegroundWindow]::GetWindowTextW($handle, $buffer, $buffer.Capacity)
        if ($length -gt 0) { $title = $buffer.ToString(0, $length) }
    }
    $processName = ''
    if ($processId -gt 0) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process) { $processName = $process.ProcessName }
    }
    $titleB64 = ''
    if ($title.Length -gt 0) {
        $titleBytes = [System.Text.Encoding]::UTF8.GetBytes($title)
        $titleB64 = [Convert]::ToBase64String($titleBytes)
    }
    $payload = @{ pid = [int]$processId; process = $processName; title = $title; titleB64 = $titleB64 } | ConvertTo-Json -Compress
    Write-Output $payload
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds $IntervalMs
}
