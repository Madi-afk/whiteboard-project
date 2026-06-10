param(
    [Parameter(Mandatory = $true)]
    [string]$AppUrl,

    [Parameter(Mandatory = $true)]
    [string]$KeycloakUrl,

    [string]$EnvFile = ".env"
)

$ErrorActionPreference = "Stop"

function Import-DotEnv {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            return
        }

        $match = [regex]::Match($line, "^\s*([^=]+?)\s*=\s*(.*)\s*$")
        if (-not $match.Success) {
            return
        }

        $name = $match.Groups[1].Value.Trim()
        $value = $match.Groups[2].Value.Trim()
        if (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

function Get-RequiredEnv {
    param([string]$Name)

    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Missing required variable: $Name"
    }

    return $value.Trim()
}

function Set-DotEnvValue {
    param(
        [string]$Path,
        [string]$Name,
        [string]$Value
    )

    $lines = @()
    if (Test-Path -LiteralPath $Path) {
        $lines = @(Get-Content -LiteralPath $Path)
    }

    $found = $false
    $nextLines = $lines | ForEach-Object {
        if ($_ -match ("^" + [regex]::Escape($Name) + "=")) {
            $found = $true
            "$Name=$Value"
        } else {
            $_
        }
    }

    if (-not $found) {
        $nextLines += "$Name=$Value"
    }

    Set-Content -LiteralPath $Path -Value $nextLines
    [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
}

function Get-KeycloakToken {
    param(
        [string]$AdminUrl,
        [string]$Username,
        [string]$Password
    )

    $tokenResponse = Invoke-RestMethod `
        -Method Post `
        -Uri "$AdminUrl/realms/master/protocol/openid-connect/token" `
        -ContentType "application/x-www-form-urlencoded" `
        -Body @{
            client_id = "admin-cli"
            username = $Username
            password = $Password
            grant_type = "password"
        }

    return $tokenResponse.access_token
}

function Normalize-Url {
    param([string]$Value)

    return $Value.Trim().TrimEnd("/")
}

$AppUrl = Normalize-Url $AppUrl
$KeycloakUrl = Normalize-Url $KeycloakUrl

if (-not $AppUrl.StartsWith("https://")) {
    throw "AppUrl must be HTTPS for Google/GitHub OAuth."
}

if (-not $KeycloakUrl.StartsWith("https://")) {
    throw "KeycloakUrl must be HTTPS for Google/GitHub OAuth."
}

Import-DotEnv -Path $EnvFile

$adminUrl = (Get-RequiredEnv "KEYCLOAK_ADMIN_URL").TrimEnd("/")
$adminUsername = Get-RequiredEnv "KEYCLOAK_ADMIN_USERNAME"
$adminPassword = Get-RequiredEnv "KEYCLOAK_ADMIN_PASSWORD"
$realmName = Get-RequiredEnv "KEYCLOAK_REALM"
$clientId = Get-RequiredEnv "KEYCLOAK_CLIENT_ID"

Set-DotEnvValue -Path $EnvFile -Name "PUBLIC_APP_URL" -Value $AppUrl
Set-DotEnvValue -Path $EnvFile -Name "KEYCLOAK_PUBLIC_URL" -Value $KeycloakUrl
Set-DotEnvValue -Path $EnvFile -Name "KEYCLOAK_REDIRECT_URI" -Value "$AppUrl/auth"

$token = Get-KeycloakToken `
    -AdminUrl $adminUrl `
    -Username $adminUsername `
    -Password $adminPassword
$headers = @{ Authorization = "Bearer $token" }

$realm = Invoke-RestMethod -Uri "$adminUrl/admin/realms/$realmName" -Headers $headers
$attributes = @{}
if ($realm.attributes) {
    $realm.attributes.PSObject.Properties | ForEach-Object {
        $attributes[$_.Name] = $_.Value
    }
}
$attributes["frontendUrl"] = $KeycloakUrl
$realm.attributes = $attributes

Invoke-RestMethod `
    -Method Put `
    -Uri "$adminUrl/admin/realms/$realmName" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body ($realm | ConvertTo-Json -Depth 80) | Out-Null

$clients = Invoke-RestMethod `
    -Uri "$adminUrl/admin/realms/$realmName/clients?clientId=$clientId" `
    -Headers $headers

if (-not $clients -or $clients.Count -eq 0) {
    throw "Keycloak client '$clientId' was not found."
}

$client = $clients[0]
$client.redirectUris = @("$AppUrl/*")
$client.webOrigins = @($AppUrl)

$clientAttributes = @{}
if ($client.attributes) {
    $client.attributes.PSObject.Properties | ForEach-Object {
        $clientAttributes[$_.Name] = $_.Value
    }
}
$clientAttributes["post.logout.redirect.uris"] = "$AppUrl/*"
$client.attributes = $clientAttributes

Invoke-RestMethod `
    -Method Put `
    -Uri "$adminUrl/admin/realms/$realmName/clients/$($client.id)" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body ($client | ConvertTo-Json -Depth 80) | Out-Null

Write-Host "Public OAuth URLs configured."
Write-Host "App URL: $AppUrl"
Write-Host "Keycloak URL: $KeycloakUrl"
Write-Host ""
Write-Host "Google redirect URI:"
Write-Host "$KeycloakUrl/realms/$realmName/broker/google/endpoint"
Write-Host "GitHub callback URL:"
Write-Host "$KeycloakUrl/realms/$realmName/broker/github/endpoint"
