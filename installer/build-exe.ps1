# Fabrique OmniInstaller.exe avec IExpress (inclus dans Windows) à partir de OmniInstaller.ps1 + Lancer.cmd.
# Usage : powershell -ExecutionPolicy Bypass -File installer\build-exe.ps1 [-Out chemin\OmniInstaller.exe]
param([string]$Out = (Join-Path $PSScriptRoot "OmniInstaller.exe"))

$ErrorActionPreference = "Stop"
$src = $PSScriptRoot
$Out = [IO.Path]::GetFullPath($Out)
$sed = Join-Path $env:TEMP "OmniInstaller.sed"

@"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$Out
FriendlyName=OmniInstaller
AppLaunched=cmd /c Lancer.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[Strings]
FILE0="OmniInstaller.ps1"
FILE1="Lancer.cmd"
[SourceFiles]
SourceFiles0=$src\
[SourceFiles0]
%FILE0%=
%FILE1%=
"@ | Set-Content -Encoding ASCII $sed

if (Test-Path $Out) { Remove-Item $Out }
Start-Process "$env:SystemRoot\System32\iexpress.exe" -ArgumentList "/N", "/Q", $sed -Wait
if (-not (Test-Path $Out)) { throw "IExpress n'a pas créé $Out" }
Write-Host "Créé : $Out"
