[CmdletBinding()]
param(
  [switch]$SkipCredentials
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RootDirectory = Split-Path -Parent $PSScriptRoot
$ExamplePath = Join-Path $RootDirectory ".env.example"
$EnvironmentPath = Join-Path $RootDirectory ".env"
$LocalEnvironmentPath = Join-Path $RootDirectory ".env.local"

function Write-Status([string]$Label, [string]$Message, [ConsoleColor]$Color) {
  Write-Host ("{0,-7} {1}" -f $Label, $Message) -ForegroundColor $Color
}

function ConvertTo-DotEnvValue([string]$Value) {
  if ($Value -notmatch "[#`r`n]" -and $Value -notmatch "^\s|\s$") {
    return $Value
  }
  if ($Value -notmatch "'") {
    return "'$Value'"
  }
  if ($Value -notmatch '"' -and $Value -notmatch "[`r`n]") {
    return '"' + $Value + '"'
  }
  throw "A credential contains quotes or line breaks that cannot be represented safely in .env. Configure it through the application settings instead."
}

function Set-DotEnvValue([string]$Path, [string]$Name, [string]$Value) {
  $Encoded = ConvertTo-DotEnvValue $Value
  $Lines = [System.Collections.Generic.List[string]]::new()
  $Found = $false
  foreach ($Line in [System.IO.File]::ReadAllLines($Path)) {
    if ($Line.StartsWith("$Name=", [System.StringComparison]::Ordinal)) {
      $Lines.Add("$Name=$Encoded")
      $Found = $true
    } else {
      $Lines.Add($Line)
    }
  }
  if (-not $Found) { $Lines.Add("$Name=$Encoded") }
  [System.IO.File]::WriteAllLines($Path, $Lines, [System.Text.UTF8Encoding]::new($false))
}

function Read-Secret([string]$Prompt) {
  $SecureValue = Read-Host $Prompt -AsSecureString
  $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
  }
}

function Test-Tool([string]$Name, [string]$Purpose, [string]$InstallCommand, [string[]]$VersionArguments = @("--version")) {
  $Command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $Command) {
    Write-Status "MISSING" "$Name - $Purpose" Yellow
    Write-Host "        Fix: $InstallCommand"
    return $false
  }
  $Version = (& $Command.Source @VersionArguments 2>&1 | Select-Object -First 1)
  Write-Status "OK" "$Name $Version ($($Command.Source))" Green
  return $true
}

if (-not (Test-Path -LiteralPath $ExamplePath -PathType Leaf)) {
  throw ".env.example was not found at $ExamplePath"
}

Write-Host "Study Buddy - native Windows setup" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $EnvironmentPath -PathType Leaf)) {
  Copy-Item -LiteralPath $ExamplePath -Destination $EnvironmentPath
  Write-Status "CREATED" ".env from .env.example" Green
} else {
  Write-Status "KEPT" ".env already exists" Yellow
}

if (-not (Test-Path -LiteralPath $LocalEnvironmentPath -PathType Leaf)) {
  [System.IO.File]::WriteAllText($LocalEnvironmentPath, @"
# Machine-specific Study Buddy overrides. This file is gitignored.
CIS_USERNAME=
CIS_PASSWORD=
MOODLE_HEADLESS=
MOODLE_BROWSER_BACKEND=
MOODLE_QUIZ_AUTO_ANSWER=false
MOODLE_QUIZ_REQUIRE_MANUAL_REVIEW=true
MOODLE_QUIZ_BLOCK_FINAL_SUBMIT=true
MOODLE_QUIZ_DRAFT_ONLY=true
MOODLE_QUIZ_ACCESS_MODE=review-only
CIS_CALENDAR_URL=
"@, [System.Text.UTF8Encoding]::new($false))
  Write-Status "CREATED" ".env.local with safe defaults" Green
}

if (-not $SkipCredentials) {
  Write-Host "Credentials remain local in gitignored files." -ForegroundColor Cyan
  $MoodleUser = Read-Host "Moodle username"
  $MoodlePassword = Read-Secret "Moodle password"
  if ($MoodleUser) { Set-DotEnvValue $EnvironmentPath "MOODLE_USERNAME" $MoodleUser }
  if ($MoodlePassword) { Set-DotEnvValue $EnvironmentPath "MOODLE_PASSWORD" $MoodlePassword }
  $MoodlePassword = $null

  $CisUser = Read-Host "CIS username (Enter to reuse Moodle username)"
  $CisPassword = Read-Secret "CIS password (Enter to reuse Moodle password)"
  if ($CisUser) { Set-DotEnvValue $LocalEnvironmentPath "CIS_USERNAME" $CisUser }
  if ($CisPassword) { Set-DotEnvValue $LocalEnvironmentPath "CIS_PASSWORD" $CisPassword }
  $CisPassword = $null
}

Write-Host "`nDependency check" -ForegroundColor Cyan
$RequiredToolsPresent = $true
$RequiredToolsPresent = (Test-Tool "node" "required runtime" "winget install --id OpenJS.NodeJS.LTS --exact") -and $RequiredToolsPresent
$RequiredToolsPresent = (Test-Tool "npx" "Playwright installer" "winget install --id OpenJS.NodeJS.LTS --exact" @("--version")) -and $RequiredToolsPresent
$null = Test-Tool "typst" "PDF generation" "winget install --id Typst.Typst --exact"
$null = Test-Tool "pdftotext" "PDF text extraction" "winget install --id oschwartz10612.Poppler --exact" @("-v")
$null = Test-Tool "pdftoppm" "PDF page rendering" "winget install --id oschwartz10612.Poppler --exact" @("-v")
$LibreOfficeCommands = Get-Command @("libreoffice", "soffice") -ErrorAction SilentlyContinue
$LibreOfficeCandidates = @($LibreOfficeCommands | ForEach-Object { $_.Source })
$LibreOfficeCandidates += Join-Path $env:ProgramFiles "LibreOffice\program\soffice.exe"
$LibreOfficePath = $LibreOfficeCandidates |
  Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
  Select-Object -First 1
if ($LibreOfficePath) {
  Write-Status "OK" "LibreOffice ($LibreOfficePath)" Green
} else {
  Write-Status "OPTIONAL" "LibreOffice conversion is unavailable" Yellow
  Write-Host "        Fix: winget install --id TheDocumentFoundation.LibreOffice --exact"
}

if (-not $RequiredToolsPresent) {
  Write-Status "WARNING" "Install the missing required runtime tools before continuing." Yellow
}
Write-Host "`nNext: npm ci; npx playwright install chromium; npm run moodle:doctor -- --version-only" -ForegroundColor Cyan
