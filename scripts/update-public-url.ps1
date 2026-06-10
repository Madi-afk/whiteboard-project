param(
    [string]$EnvFile = ".env",
    [int]$Port = 5173,
    [string]$PreferredInterface = "",
    [switch]$Restart
)

$ErrorActionPreference = "Stop"

function Get-ShareAddress {
    param([string]$InterfaceName)

    $addresses = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.PrefixOrigin -ne "WellKnown" -and
            $_.InterfaceAlias -notmatch "vEthernet|Default Switch|Docker|WSL"
        }

    if ($InterfaceName) {
        $matched = $addresses |
            Where-Object { $_.InterfaceAlias -like "*$InterfaceName*" } |
            Select-Object -First 1

        if ($matched) {
            return $matched.IPAddress
        }

        throw "No IPv4 address found for interface matching '$InterfaceName'."
    }

    $preferred = $addresses |
        ForEach-Object {
            $isPrivateLan =
                $_.IPAddress -like "10.*" -or
                $_.IPAddress -like "192.168.*" -or
                $_.IPAddress -match "^172\.(1[6-9]|2[0-9]|3[0-1])\."
            $isVpn = $_.InterfaceAlias -match "Radmin|VPN"
            $priority = if ($isPrivateLan -and -not $isVpn) {
                0
            } elseif (-not $isVpn) {
                1
            } else {
                2
            }

            [pscustomobject]@{
                IPAddress = $_.IPAddress
                InterfaceAlias = $_.InterfaceAlias
                Priority = $priority
            }
        } |
        Sort-Object Priority, InterfaceAlias |
        Select-Object -First 1

    if (-not $preferred) {
        throw "No shareable IPv4 address found."
    }

    return $preferred.IPAddress
}

function Set-DotEnvValue {
    param(
        [string]$Path,
        [string]$Name,
        [string]$Value
    )

    $line = "$Name=$Value"

    if (-not (Test-Path -LiteralPath $Path)) {
        Set-Content -LiteralPath $Path -Value $line
        return
    }

    $lines = Get-Content -LiteralPath $Path
    $found = $false
    $nextLines = foreach ($item in $lines) {
        if ($item -match "^\s*$([regex]::Escape($Name))\s*=") {
            $found = $true
            $line
        } else {
            $item
        }
    }

    if (-not $found) {
        $nextLines += $line
    }

    Set-Content -LiteralPath $Path -Value $nextLines
}

$ipAddress = Get-ShareAddress -InterfaceName $PreferredInterface
$publicUrl = "http://${ipAddress}:$Port"

Set-DotEnvValue -Path $EnvFile -Name "PUBLIC_APP_URL" -Value $publicUrl

Write-Host "PUBLIC_APP_URL updated: $publicUrl"

if ($Restart) {
    docker compose up -d backend frontend
} else {
    Write-Host "Restart backend to apply it: docker compose up -d backend"
}
