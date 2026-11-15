# Read-only Windows capability probe. It never logs window titles or contents.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class StudyPetForegroundProbe {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int maxCount);
}
'@
$validHandles = 0
$validProcesses = 0
$captionsPresent = 0
for ($sampleIndex = 0; $sampleIndex -lt 5; $sampleIndex++) {
    $windowHandle = [StudyPetForegroundProbe]::GetForegroundWindow()
    if ($windowHandle -ne [IntPtr]::Zero) {
        $validHandles++
        [uint32]$foregroundProcessId = 0
        $threadId = [StudyPetForegroundProbe]::GetWindowThreadProcessId($windowHandle, [ref]$foregroundProcessId)
        if (($threadId -gt 0) -and ($foregroundProcessId -gt 0)) { $validProcesses++ }
        $caption = New-Object System.Text.StringBuilder 512
        $captionLength = [StudyPetForegroundProbe]::GetWindowTextW($windowHandle, $caption, $caption.Capacity)
        if ($captionLength -gt 0) { $captionsPresent++ }
    }
    Start-Sleep -Milliseconds 100
}
[PSCustomObject]@{
    probe = 'Windows foreground APIs'
    sampleCount = 5
    validHandleCount = $validHandles
    validProcessCount = $validProcesses
    nonemptyCaptionCount = $captionsPresent
    windowTextLogged = $false
    provesTaskRelevance = $false
} | ConvertTo-Json
