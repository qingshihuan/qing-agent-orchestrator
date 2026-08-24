param(
  [switch] $Validate,
  [string] $ValidationRoot
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$standardRoot = Join-Path $projectRoot ".agents\skills\qing-agent-orchestrator"
$fullRoot = Join-Path $projectRoot ".agents\skills\qing-agent-orchestrator-full"
$artifactsRoot = Join-Path $projectRoot "artifacts"
$runtimeRoot = Join-Path $fullRoot "runtime"
$checksumManifest = Join-Path $artifactsRoot "SHA256SUMS.txt"

function Get-RelativeFileList([string] $Root) {
  return @(Get-ChildItem -LiteralPath $Root -Recurse -File | ForEach-Object {
    $_.FullName.Substring($Root.Length + 1).Replace("\", "/")
  } | Sort-Object)
}

function Assert-ExactFileSet([string[]] $Expected, [string[]] $Actual, [string] $Label) {
  $difference = @(Compare-Object -ReferenceObject @($Expected | Sort-Object) -DifferenceObject @($Actual | Sort-Object))
  if ($difference.Count -ne 0) { throw "$Label file set mismatch: $($difference | ConvertTo-Json -Compress)" }
}

foreach ($required in @(
  (Join-Path $standardRoot "SKILL.md"),
  (Join-Path $standardRoot "schemas\handoff.schema.json"),
  (Join-Path $standardRoot "schemas\review.schema.json"),
  (Join-Path $fullRoot "SKILL.md"),
  (Join-Path $projectRoot "dist\src\cli.js"),
  (Join-Path $projectRoot "schemas"),
  (Join-Path $projectRoot "config\relay.example.json")
)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required packaging input is missing: $required" }
}

New-Item -ItemType Directory -Force -Path $artifactsRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeRoot "dist") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeRoot "config") | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot "dist\src") -Destination (Join-Path $runtimeRoot "dist") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "schemas") -Destination $runtimeRoot -Recurse -Force
$rootPackageText = [System.IO.File]::ReadAllText((Join-Path $projectRoot "package.json"))
$rootPackageText = $rootPackageText.Replace("`r`n", "`n").Replace("`r", "`n")
[System.IO.File]::WriteAllText((Join-Path $runtimeRoot "package.json"), $rootPackageText, [System.Text.UTF8Encoding]::new($false))

$safeConfig = @'
{
  "executor": {
    "mode": "dry-run",
    "codexExec": {
      "enabled": false,
      "command": "codex",
      "timeoutMs": 900000,
      "probeTimeoutMs": 10000,
      "sandbox": "workspace-write",
      "ephemeral": true,
      "ignoreUserConfig": true,
      "skipGitRepoCheck": false,
      "windowsSandbox": null,
      "outputSchemaPath": "schemas/executor-result.schema.json",
      "maxOutputBytes": 4194304
    }
  },
  "relay": { "maxIterations": 3 },
  "runtime": { "stateDirectory": ".qing/runs" },
  "modelRouting": { "mode": "inherit", "healthTtlMs": 3600000, "probeTimeoutMs": 30000, "candidates": [] },
  "security": { "approvedGateIds": [] }
}
'@
$safeConfig = $safeConfig.Replace("`r`n", "`n").Replace("`r", "`n")
[System.IO.File]::WriteAllText((Join-Path $runtimeRoot "config\relay.user.json"), $safeConfig, [System.Text.UTF8Encoding]::new($false))

$standardZip = Join-Path $artifactsRoot "qing-agent-orchestrator-standard.zip"
$fullZip = Join-Path $artifactsRoot "qing-agent-orchestrator-full.zip"
Compress-Archive -Path (Join-Path $standardRoot "*") -DestinationPath $standardZip -Force
Compress-Archive -Path (Join-Path $fullRoot "*") -DestinationPath $fullZip -Force

$archiveNames = @(
  "qing-agent-orchestrator-standard.zip",
  "qing-agent-orchestrator-full.zip"
)
$checksumLines = @($archiveNames | ForEach-Object {
  $hash = (Get-FileHash -LiteralPath (Join-Path $artifactsRoot $_) -Algorithm SHA256).Hash
  "$hash  $_"
})
[System.IO.File]::WriteAllText($checksumManifest, ($checksumLines -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))

if ($Validate) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $manifestEntries = @{}
  $manifestLines = @(Get-Content -LiteralPath $checksumManifest)
  if ($manifestLines.Count -ne 2) { throw "Checksum manifest must contain exactly two entries." }
  foreach ($line in $manifestLines) {
    if ($line -notmatch '^([0-9A-Fa-f]{64})  ([^\\/]+\.zip)$') { throw "Malformed checksum manifest entry: $line" }
    $name = $matches[2]
    if ($manifestEntries.ContainsKey($name)) { throw "Duplicate checksum manifest entry: $name" }
    $manifestEntries[$name] = $matches[1].ToUpperInvariant()
  }
  Assert-ExactFileSet $archiveNames @($manifestEntries.Keys) "Checksum manifest"
  foreach ($name in $archiveNames) {
    $actualHash = (Get-FileHash -LiteralPath (Join-Path $artifactsRoot $name) -Algorithm SHA256).Hash
    if ($actualHash -ne $manifestEntries[$name]) { throw "Checksum manifest hash mismatch: $name" }
  }
  if ([string]::IsNullOrWhiteSpace($ValidationRoot)) {
    $validationBoundary = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd("\")
    $validationRoot = [System.IO.Path]::GetFullPath((Join-Path $validationBoundary ("qing-skill-validation-" + [Guid]::NewGuid().ToString("N"))))
  }
  else {
    if ([System.IO.Path]::IsPathRooted($ValidationRoot)) { throw "ValidationRoot must be workspace-relative." }
    $validationBoundary = [System.IO.Path]::GetFullPath((Join-Path $projectRoot ".qing\package-validation")).TrimEnd("\")
    $validationRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $ValidationRoot))
    if (-not $validationRoot.StartsWith($validationBoundary + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "ValidationRoot must resolve below .qing\package-validation."
    }
    if (Test-Path -LiteralPath $validationRoot) { throw "ValidationRoot already exists: $validationRoot" }
  }
  if (-not $validationRoot.StartsWith($validationBoundary + "\", [System.StringComparison]::OrdinalIgnoreCase)) { throw "Validation directory escaped its approved boundary." }
  New-Item -ItemType Directory -Path $validationRoot | Out-Null
  try {
    $standardExtract = Join-Path $validationRoot "standard"
    $fullExtract = Join-Path $validationRoot "full"
    [System.IO.Compression.ZipFile]::ExtractToDirectory($standardZip, $standardExtract)
    [System.IO.Compression.ZipFile]::ExtractToDirectory($fullZip, $fullExtract)

    foreach ($entry in @(
      @{ Root = $standardExtract; Name = "qing-agent-orchestrator" },
      @{ Root = $fullExtract; Name = "qing-agent-orchestrator-full" }
    )) {
      $skillText = Get-Content -Raw -LiteralPath (Join-Path $entry.Root "SKILL.md")
      if ($skillText -notmatch ("(?m)^name:\s*" + [regex]::Escape($entry.Name) + "\s*$")) { throw "Extracted skill name mismatch: $($entry.Name)" }
      $yamlText = Get-Content -Raw -LiteralPath (Join-Path $entry.Root "agents\openai.yaml")
      if ($yamlText -notmatch [regex]::Escape("$" + $entry.Name)) { throw "openai.yaml default_prompt does not name `$$($entry.Name)" }
    }

    if (Test-Path -LiteralPath (Join-Path $standardExtract "scripts")) { throw "Standard archive unexpectedly contains scripts." }
    if (Test-Path -LiteralPath (Join-Path $standardExtract "runtime")) { throw "Standard archive unexpectedly contains runtime." }
    $expectedStandardFiles = @(
      "agents/openai.yaml",
      "references/handoff-protocol.md",
      "references/orchestrator-spec.md",
      "references/reviewer-rules.md",
      "references/safety-gates.md",
      "schemas/handoff.schema.json",
      "schemas/review.schema.json",
      "SKILL.md"
    ) | Sort-Object
    $actualStandardFiles = Get-RelativeFileList $standardExtract
    Assert-ExactFileSet $expectedStandardFiles $actualStandardFiles "Standard archive"
    foreach ($relativePath in $expectedStandardFiles) {
      $sourceHash = (Get-FileHash -LiteralPath (Join-Path $standardRoot $relativePath.Replace("/", "\")) -Algorithm SHA256).Hash
      $archiveHash = (Get-FileHash -LiteralPath (Join-Path $standardExtract $relativePath.Replace("/", "\")) -Algorithm SHA256).Hash
      if ($sourceHash -ne $archiveHash) { throw "Standard archive content mismatch: $relativePath" }
    }

    $standardText = (Get-ChildItem -LiteralPath $standardExtract -Recurse -File | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) -join "`n"
    if ($standardText -match "codex\s+exec|Codex CLI|QING_RELAY_HOME|qing\.ps1") { throw "Standard archive contains a CLI marker." }
    $standardMarkdown = (Get-ChildItem -LiteralPath $standardExtract -Recurse -File -Filter "*.md" | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) -join "`n"
    $schemaReferences = @([regex]::Matches($standardMarkdown, "schemas/[A-Za-z0-9._-]+\.json") | ForEach-Object { $_.Value } | Sort-Object -Unique)
    foreach ($schemaReference in $schemaReferences) {
      $resolvedSchema = Join-Path $standardExtract $schemaReference.Replace("/", "\")
      if (-not (Test-Path -LiteralPath $resolvedSchema)) { throw "Standard archive contains an unresolved schema reference: $schemaReference" }
    }
    $standardHandoffText = Get-Content -Raw -LiteralPath (Join-Path $standardExtract "schemas\handoff.schema.json")
    $standardReviewText = Get-Content -Raw -LiteralPath (Join-Path $standardExtract "schemas\review.schema.json")
    $standardHandoffSchema = $standardHandoffText | ConvertFrom-Json
    $standardReviewSchema = $standardReviewText | ConvertFrom-Json
    if ($standardHandoffSchema.'$id' -ne "https://qing.local/schemas/desktop/handoff.schema.json") { throw "Standard Handoff schema is not desktop-specific." }
    if ($standardReviewSchema.'$id' -ne "https://qing.local/schemas/desktop/review.schema.json") { throw "Standard Review schema is not desktop-specific." }
    if ($standardHandoffText -match 'relayVerification|process\.started|process\.exited|process\.heartbeat|sandbox\.preflight|"pid"|"exitCode"|"elapsedMs"|"effectiveSandbox"') {
      throw "Standard Handoff schema contains an external-process runtime contract."
    }
    if ($standardReviewSchema.properties.iteration.maximum -ne 5) { throw "Standard Review schema does not cap iteration at five." }
    foreach ($requiredReviewField in @("executorStatus", "deliverables", "pendingOperations")) {
      if ($standardReviewSchema.required -notcontains $requiredReviewField) { throw "Standard Review schema is missing $requiredReviewField." }
    }
    $passRule = @($standardReviewSchema.allOf | Where-Object { $_.'if'.properties.verdict.const -eq "PASS" })
    if ($passRule.Count -ne 1) { throw "Standard Review schema must define exactly one PASS guard." }
    $passProperties = $passRule[0].then.properties
    if ($passProperties.executorStatus.const -ne "succeeded" -or
        $passProperties.criteria.items.properties.status.const -ne "pass" -or
        $passProperties.criterionAudit.items.properties.status.const -ne "pass" -or
        $passProperties.tests.items.properties.status.const -ne "passed" -or
        $passProperties.deliverables.items.properties.status.const -ne "present" -or
        $passProperties.pendingOperations.maxItems -ne 0 -or
        $passProperties.revisionInstructions.maxItems -ne 0) {
      throw "Standard Review schema PASS guard is incomplete."
    }

    $declaredFullSkillFiles = @(
      "agents/openai.yaml",
      "references/codex-exec.md",
      "references/execution-modes.md",
      "references/handoff-protocol.md",
      "references/orchestrator-spec.md",
      "references/reviewer-rules.md",
      "references/safety-gates.md",
      "scripts/qing.ps1",
      "SKILL.md"
    )
    $generatedRuntimeFiles = @(
      Get-RelativeFileList (Join-Path $projectRoot "dist\src") | ForEach-Object { "runtime/dist/src/$_" }
      Get-RelativeFileList (Join-Path $projectRoot "schemas") | ForEach-Object { "runtime/schemas/$_" }
      "runtime/config/relay.user.json"
      "runtime/package.json"
    )
    $expectedFullFiles = @($declaredFullSkillFiles + $generatedRuntimeFiles | Sort-Object)
    Assert-ExactFileSet $expectedFullFiles (Get-RelativeFileList $fullRoot) "Full source tree"
    Assert-ExactFileSet $expectedFullFiles (Get-RelativeFileList $fullExtract) "Full archive"
    foreach ($relativePath in $expectedFullFiles) {
      $sourcePath = if ($relativePath.StartsWith("runtime/dist/src/")) {
        Join-Path (Join-Path $projectRoot "dist\src") $relativePath.Substring("runtime/dist/src/".Length).Replace("/", "\")
      }
      elseif ($relativePath.StartsWith("runtime/schemas/")) {
        Join-Path (Join-Path $projectRoot "schemas") $relativePath.Substring("runtime/schemas/".Length).Replace("/", "\")
      }
      else {
        Join-Path $fullRoot $relativePath.Replace("/", "\")
      }
      $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
      $archiveHash = (Get-FileHash -LiteralPath (Join-Path $fullExtract $relativePath.Replace("/", "\")) -Algorithm SHA256).Hash
      if ($sourceHash -ne $archiveHash) { throw "Full archive content mismatch: $relativePath" }
    }
    $executable = Get-ChildItem -LiteralPath $fullExtract -Recurse -File | Where-Object { $_.Name -ieq "codex.exe" }
    if ($executable) { throw "Full archive must not bundle codex.exe." }
  }
  finally {
    if (Test-Path -LiteralPath $validationRoot) {
      $resolvedValidation = [System.IO.Path]::GetFullPath($validationRoot)
      if (-not $resolvedValidation.StartsWith($validationBoundary + "\", [System.StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to remove a validation directory outside its approved boundary." }
      Remove-Item -LiteralPath $resolvedValidation -Recurse -Force
    }
  }
}

[pscustomobject]@{
  standard = $standardZip
  full = $fullZip
  validated = [bool]$Validate
} | ConvertTo-Json
