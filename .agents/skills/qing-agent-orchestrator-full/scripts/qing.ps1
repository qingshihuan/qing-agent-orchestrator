param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $RelayArguments
)

$skillRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$bundledRelay = [System.IO.Path]::GetFullPath((Join-Path $skillRoot "runtime"))
$projectRelay = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))
$relayHome = $env:QING_RELAY_HOME

if ([string]::IsNullOrWhiteSpace($relayHome)) {
  if (Test-Path -LiteralPath (Join-Path $bundledRelay "dist\src\cli.js")) {
    $relayHome = $bundledRelay
  }
  elseif (Test-Path -LiteralPath (Join-Path $projectRelay "dist\src\cli.js")) {
    $relayHome = $projectRelay
  }
  else {
    throw "Qing Relay runtime was not found. Reinstall the full edition or set QING_RELAY_HOME to its absolute installation directory."
  }
}
elseif (-not [System.IO.Path]::IsPathRooted($relayHome)) {
  throw "QING_RELAY_HOME must be an absolute directory path."
}
else {
  $relayHome = [System.IO.Path]::GetFullPath($relayHome)
}

$entrypoint = Join-Path $relayHome "dist\src\cli.js"
$config = Join-Path $relayHome "config\relay.user.json"
if (-not (Test-Path -LiteralPath $entrypoint)) {
  throw "Qing Relay entrypoint is missing: $entrypoint"
}
if (-not (Test-Path -LiteralPath $config)) {
  throw "Qing Relay user configuration is missing: $config"
}

& node $entrypoint @RelayArguments --config $config
exit $LASTEXITCODE
