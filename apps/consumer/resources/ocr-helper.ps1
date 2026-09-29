# Daylens OCR helper: long-lived Windows PowerShell 5.1 process wrapping Windows.Media.Ocr (built into Windows 10/11).
# Protocol (stdin lines → stdout JSON lines):
#   "<id> CAPTURE"       capture the foreground window in memory and OCR it → {id,text,ms,pid,title,w,h} | {id,error}
#   "<id> <base64 png>"  OCR a PNG (dev bench)                              → {id,text,ms} | {id,error}
# Images live only in this process's memory; nothing is written to disk.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DaylensFg {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
}
"@
# Per-monitor DPI aware (v2) so window bounds and screen copies use physical pixels.
[void][DaylensFg]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))

$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)) }

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { Emit @{ ready = $false; error = 'no_ocr_language' }; exit 2 }
$maxDim = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension

function Ocr-Bytes([byte[]]$bytes) {
  $stream = $null; $writer = $null; $bitmap = $null
  try {
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $writer = New-Object Windows.Storage.Streams.DataWriter($stream)
    $writer.WriteBytes($bytes)
    $null = Await ($writer.StoreAsync()) ([UInt32])
    $null = $writer.DetachStream()
    $stream.Seek(0)
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    return (($result.Lines | ForEach-Object { $_.Text }) -join "`n")
  } finally {
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    if ($null -ne $writer) { $writer.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
  }
}

$PW_RENDERFULLCONTENT = 2

# Captures the foreground window's own pixels via PrintWindow (never CopyFromScreen: a screen-rectangle
# grab picks up whatever is topmost on screen — toasts, always-on-top or PiP windows — and would attribute
# that text to the foreground app, bypassing its exclusions). Returns $null when there is no capturable
# foreground window, a hashtable with an `error` key on a capture failure or a mid-capture window switch,
# or a hashtable with the PNG bytes and metadata on success.
function Capture-Foreground {
  $h = [DaylensFg]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero -or [DaylensFg]::IsIconic($h)) { return $null }
  # A hung (not responding) window would block PrintWindow until our timeout and flip OCR status to failed: skip it.
  if ([DaylensFg]::IsHungAppWindow($h)) { return $null }
  [uint32]$procId = 0
  [void][DaylensFg]::GetWindowThreadProcessId($h, [ref]$procId)
  $sbPre = New-Object System.Text.StringBuilder 512
  [void][DaylensFg]::GetWindowText($h, $sbPre, 512)
  $preTitle = $sbPre.ToString()
  $r = New-Object 'DaylensFg+RECT'
  if (-not [DaylensFg]::GetWindowRect($h, [ref]$r)) { return $null }
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  if ($w -le 0 -or $hh -le 0) { return $null }
  $bmp = $null; $scaled = $null; $ms = $null; $g = $null
  try {
    $bmp = New-Object System.Drawing.Bitmap $w, $hh
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    $ok = $false
    try { $ok = [DaylensFg]::PrintWindow($h, $hdc, $PW_RENDERFULLCONTENT) } finally { $g.ReleaseHdc($hdc) }
    if (-not $ok) { return @{ error = 'capture_failed' } }
    # The foreground window may have changed while PrintWindow rendered: never attribute those pixels
    # to a different (or now-hidden) window. Re-read after the capture and report that title.
    if ([DaylensFg]::GetForegroundWindow() -ne $h) { return @{ error = 'window_changed' } }
    $sbPost = New-Object System.Text.StringBuilder 512
    [void][DaylensFg]::GetWindowText($h, $sbPost, 512)
    $postTitle = $sbPost.ToString()
    if ($postTitle -ne $preTitle) { return @{ error = 'window_changed' } }
    $src = $bmp
    if ($w -gt $maxDim -or $hh -gt $maxDim) {
      $k = [Math]::Min($maxDim / $w, $maxDim / $hh)
      $scaled = New-Object System.Drawing.Bitmap $bmp, ([int]($w * $k)), ([int]($hh * $k))
      $src = $scaled
    }
    $ms = New-Object System.IO.MemoryStream
    $src.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    return @{ bytes = $ms.ToArray(); pid = [int]$procId; title = $postTitle; w = $w; h = $hh }
  } finally {
    if ($null -ne $ms) { $ms.Dispose() }
    if ($null -ne $scaled) { $scaled.Dispose() }
    if ($null -ne $g) { $g.Dispose() }
    if ($null -ne $bmp) { $bmp.Dispose() }
  }
}

Emit @{ ready = $true }

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $sp = $line.IndexOf(' ')
  $id = if ($sp -gt 0) { $line.Substring(0, $sp) } else { $line }
  try {
    if ($sp -le 0) { throw 'malformed request' }
    $arg = $line.Substring($sp + 1)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    if ($arg -eq 'CAPTURE') {
      $cap = Capture-Foreground
      if ($null -eq $cap) { Emit @{ id = $id; error = 'no_window' }; continue }
      if ($cap.ContainsKey('error')) { Emit @{ id = $id; error = $cap.error }; continue }
      $text = Ocr-Bytes $cap.bytes
      Emit @{ id = $id; text = $text; ms = $sw.ElapsedMilliseconds; pid = $cap.pid; title = $cap.title; w = $cap.w; h = $cap.h }
    } else {
      $text = Ocr-Bytes ([Convert]::FromBase64String($arg))
      Emit @{ id = $id; text = $text; ms = $sw.ElapsedMilliseconds }
    }
  } catch {
    Emit @{ id = $id; error = "$($_.Exception.Message)" }
  }
}
