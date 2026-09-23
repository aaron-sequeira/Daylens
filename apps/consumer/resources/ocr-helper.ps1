# Daylens OCR helper: long-lived Windows PowerShell 5.1 process wrapping Windows.Media.Ocr (built into Windows 10/11).
# Protocol: stdin lines "<id> <base64 png>"; stdout JSON lines. Images are decoded in memory and never written to disk.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
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
Emit @{ ready = $true }

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $sp = $line.IndexOf(' ')
  $id = if ($sp -gt 0) { $line.Substring(0, $sp) } else { $line }
  $stream = $null
  $writer = $null
  $bitmap = $null
  try {
    if ($sp -le 0) { throw 'malformed request' }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $bytes = [Convert]::FromBase64String($line.Substring($sp + 1))
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $writer = New-Object Windows.Storage.Streams.DataWriter($stream)
    $writer.WriteBytes($bytes)
    $null = Await ($writer.StoreAsync()) ([UInt32])
    $null = $writer.DetachStream()
    $stream.Seek(0)
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $text = ($result.Lines | ForEach-Object { $_.Text }) -join "`n"
    Emit @{ id = $id; text = $text; ms = $sw.ElapsedMilliseconds }
  } catch {
    Emit @{ id = $id; error = "$($_.Exception.Message)" }
  } finally {
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    if ($null -ne $writer) { $writer.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
  }
}
