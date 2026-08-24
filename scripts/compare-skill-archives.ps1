param(
  [Parameter(Mandatory = $true)]
  [string] $CommittedRoot,

  [Parameter(Mandatory = $true)]
  [string] $GeneratedRoot,

  [Parameter(Mandatory = $true)]
  [string] $ScratchRoot
)

$ErrorActionPreference = "Stop"
$archiveNames = @(
  "qing-agent-orchestrator-standard.zip",
  "qing-agent-orchestrator-full.zip"
)

function Get-NormalizedRoot([string] $Path, [string] $Label) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
    throw "$Label does not exist or is not a directory: $resolved"
  }
  return $resolved.TrimEnd("\", "/")
}

function Get-Manifest([string] $Root, [string] $Label) {
  $manifestPath = Join-Path $Root "SHA256SUMS.txt"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "$Label checksum manifest is missing: $manifestPath"
  }

  $entries = @{}
  $lines = @(Get-Content -LiteralPath $manifestPath)
  if ($lines.Count -ne $archiveNames.Count) {
    throw "$Label checksum manifest must contain exactly $($archiveNames.Count) entries."
  }

  foreach ($line in $lines) {
    if ($line -notmatch '^([0-9A-Fa-f]{64})  ([^\\/]+\.zip)$') {
      throw "$Label checksum manifest contains a malformed entry: $line"
    }
    $name = $matches[2]
    if ($archiveNames -notcontains $name) {
      throw "$Label checksum manifest contains an unexpected archive: $name"
    }
    if ($entries.ContainsKey($name)) {
      throw "$Label checksum manifest contains a duplicate archive: $name"
    }
    $entries[$name] = $matches[1].ToUpperInvariant()
  }

  foreach ($name in $archiveNames) {
    if (-not $entries.ContainsKey($name)) {
      throw "$Label checksum manifest is missing $name"
    }
    $archivePath = Join-Path $Root $name
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
      throw "$Label archive is missing: $archivePath"
    }
    $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    if ($actual -ne $entries[$name]) {
      throw "$Label checksum mismatch for $name"
    }
  }

  return $entries
}

function Get-RelativeFiles([string] $Root) {
  return @(
    Get-ChildItem -LiteralPath $Root -Recurse -File |
      ForEach-Object { $_.FullName.Substring($Root.Length + 1).Replace("\", "/") } |
      Sort-Object
  )
}

function Assert-ArchiveContentEqual(
  [string] $CommittedArchive,
  [string] $GeneratedArchive,
  [string] $ArchiveName,
  [string] $Scratch
) {
  $archiveScratch = Join-Path $Scratch ([System.IO.Path]::GetFileNameWithoutExtension($ArchiveName))
  $committedExtract = Join-Path $archiveScratch "committed"
  $generatedExtract = Join-Path $archiveScratch "generated"
  New-Item -ItemType Directory -Path $committedExtract -Force | Out-Null
  New-Item -ItemType Directory -Path $generatedExtract -Force | Out-Null

  [System.IO.Compression.ZipFile]::ExtractToDirectory($CommittedArchive, $committedExtract)
  [System.IO.Compression.ZipFile]::ExtractToDirectory($GeneratedArchive, $generatedExtract)

  $committedFiles = Get-RelativeFiles $committedExtract
  $generatedFiles = Get-RelativeFiles $generatedExtract
  $difference = @(Compare-Object -ReferenceObject $committedFiles -DifferenceObject $generatedFiles)
  if ($difference.Count -ne 0) {
    throw "$ArchiveName file set differs from the freshly generated package: $($difference | ConvertTo-Json -Compress)"
  }

  foreach ($relativePath in $committedFiles) {
    $committedHash = (Get-FileHash -LiteralPath (Join-Path $committedExtract $relativePath.Replace("/", "\")) -Algorithm SHA256).Hash
    $generatedHash = (Get-FileHash -LiteralPath (Join-Path $generatedExtract $relativePath.Replace("/", "\")) -Algorithm SHA256).Hash
    if ($committedHash -ne $generatedHash) {
      throw "$ArchiveName content differs for $relativePath"
    }
  }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$committed = Get-NormalizedRoot $CommittedRoot "Committed artifact root"
$generated = Get-NormalizedRoot $GeneratedRoot "Generated artifact root"
$scratch = [System.IO.Path]::GetFullPath($ScratchRoot).TrimEnd("\", "/")
if ([string]::IsNullOrWhiteSpace($scratch) -or $scratch -eq [System.IO.Path]::GetPathRoot($scratch)) {
  throw "ScratchRoot must be a specific directory, not a filesystem root."
}
if (Test-Path -LiteralPath $scratch) {
  throw "ScratchRoot already exists: $scratch"
}

Get-Manifest $committed "Committed" | Out-Null
Get-Manifest $generated "Generated" | Out-Null
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
  foreach ($name in $archiveNames) {
    Assert-ArchiveContentEqual `
      (Join-Path $committed $name) `
      (Join-Path $generated $name) `
      $name `
      $scratch
  }
}
finally {
  if (Test-Path -LiteralPath $scratch) {
    Remove-Item -LiteralPath $scratch -Recurse -Force
  }
}

[pscustomobject]@{
  archives = $archiveNames
  committedRoot = $committed
  generatedRoot = $generated
  equivalent = $true
} | ConvertTo-Json
