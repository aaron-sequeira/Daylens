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
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
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

function Capture-Foreground {
  $h = [DaylensFg]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero -or [DaylensFg]::IsIconic($h)) { return $null }
  $r = New-Object 'DaylensFg+RECT'
  if ([DaylensFg]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) -ne 0) { return $null } # DWMWA_EXTENDED_FRAME_BOUNDS
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  if ($w -le 0 -or $hh -le 0) { return $null }
  [uint32]$procId = 0
  [void][DaylensFg]::GetWindowThreadProcessId($h, [ref]$procId)
  $sb = New-Object System.Text.StringBuilder 512
  [void][DaylensFg]::GetWindowText($h, $sb, 512)
  $bmp = $null; $scaled = $null; $ms = $null
  try {
    $bmp = New-Object System.Drawing.Bitmap $w, $hh
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size) } finally { $g.Dispose() }
    $src = $bmp
    if ($w -gt $maxDim -or $hh -gt $maxDim) {
      $k = [Math]::Min($maxDim / $w, $maxDim / $hh)
      $scaled = New-Object System.Drawing.Bitmap $bmp, ([int]($w * $k)), ([int]($hh * $k))
      $src = $scaled
    }
    $ms = New-Object System.IO.MemoryStream
    $src.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    return @{ bytes = $ms.ToArray(); pid = [int]$procId; title = $sb.ToString(); w = $w; h = $hh }
  } finally {
    if ($null -ne $ms) { $ms.Dispose() }
    if ($null -ne $scaled) { $scaled.Dispose() }
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
