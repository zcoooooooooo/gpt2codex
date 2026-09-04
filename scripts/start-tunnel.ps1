param(
    [Parameter(Mandatory = $true)]
    [string]$Workspace,

    [Parameter(Mandatory = $true)]
    [string]$TunnelId
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$client = Join-Path $root ".local\tunnel-client\tunnel-client.exe"
$server = Join-Path $root "plugins\gpt2codex\mcp\server.mjs"
$profileDir = Join-Path $root ".local\profiles"

if (-not (Test-Path -LiteralPath $client -PathType Leaf)) {
    throw "Missing tunnel-client.exe. Download it to $client first."
}

$workspacePath = (Resolve-Path -LiteralPath $Workspace).Path
if (-not (Test-Path -LiteralPath $workspacePath -PathType Container)) {
    throw "Workspace must be an existing folder."
}

if ([string]::IsNullOrWhiteSpace($env:CONTROL_PLANE_API_KEY)) {
    $secureKey = Read-Host "Enter the Runtime API key" -AsSecureString
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    try {
        $env:CONTROL_PLANE_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }
}

$serverCommandPath = $server.Replace("\", "/")
$workspaceCommandPath = $workspacePath.Replace("\", "/")
$mcpCommand = 'node "{0}" --workspace "{1}"' -f $serverCommandPath, $workspaceCommandPath
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

& $client runtimes connect `
    --alias gpt2codex `
    --profile gpt2codex `
    --profile-dir $profileDir `
    --tunnel-id $TunnelId `
    --runtime-api-key env:CONTROL_PLANE_API_KEY `
    --mcp-command $mcpCommand
if ($LASTEXITCODE -ne 0) {
    throw "Tunnel startup failed."
}

& $client runtimes status gpt2codex --json
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read Tunnel runtime status."
}
