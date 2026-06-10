param(
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

function Get-OptionalEnv {
    param(
        [string]$Name,
        [string]$Default = ""
    )

    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $Default
    }

    return $value.Trim()
}

function ConvertTo-BooleanString {
    param([string]$Value)

    return "$($Value.Trim().ToLower() -eq 'true')".ToLower()
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

function Test-IdentityProviderExists {
    param(
        [string]$AdminUrl,
        [string]$RealmName,
        [string]$Alias,
        [hashtable]$Headers
    )

    try {
        Invoke-RestMethod `
            -Uri "$AdminUrl/admin/realms/$RealmName/identity-provider/instances/$Alias" `
            -Headers $Headers | Out-Null
        return $true
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -eq 404) {
            return $false
        }

        throw
    }
}

function Upsert-IdentityProvider {
    param(
        [string]$AdminUrl,
        [string]$RealmName,
        [hashtable]$Headers,
        [string]$Alias,
        [string]$ProviderId,
        [string]$ClientId,
        [string]$ClientSecret,
        [hashtable]$Config
    )

    if ([string]::IsNullOrWhiteSpace($ClientId) -or [string]::IsNullOrWhiteSpace($ClientSecret)) {
        Write-Host "Skipping '$Alias': client id or secret is empty."
        return $false
    }

    $Config.clientId = $ClientId
    $Config.clientSecret = $ClientSecret
    $Config.syncMode = "IMPORT"

    $identityProvider = [ordered]@{
        alias = $Alias
        displayName = $Alias.Substring(0, 1).ToUpper() + $Alias.Substring(1)
        providerId = $ProviderId
        enabled = $true
        trustEmail = $true
        storeToken = $false
        addReadTokenRoleOnCreate = $false
        authenticateByDefault = $false
        linkOnly = $false
        firstBrokerLoginFlowAlias = "first broker login"
        config = $Config
    }

    $body = $identityProvider | ConvertTo-Json -Depth 20
    $exists = Test-IdentityProviderExists `
        -AdminUrl $AdminUrl `
        -RealmName $RealmName `
        -Alias $Alias `
        -Headers $Headers

    if ($exists) {
        Invoke-RestMethod `
            -Method Put `
            -Uri "$AdminUrl/admin/realms/$RealmName/identity-provider/instances/$Alias" `
            -Headers $Headers `
            -ContentType "application/json" `
            -Body $body | Out-Null
        Write-Host "Updated Keycloak identity provider: $Alias"
    } else {
        Invoke-RestMethod `
            -Method Post `
            -Uri "$AdminUrl/admin/realms/$RealmName/identity-provider/instances" `
            -Headers $Headers `
            -ContentType "application/json" `
            -Body $body | Out-Null
        Write-Host "Created Keycloak identity provider: $Alias"
    }

    return $true
}

Import-DotEnv -Path $EnvFile

$adminUrl = (Get-RequiredEnv "KEYCLOAK_ADMIN_URL").TrimEnd("/")
$adminUsername = Get-RequiredEnv "KEYCLOAK_ADMIN_USERNAME"
$adminPassword = Get-RequiredEnv "KEYCLOAK_ADMIN_PASSWORD"
$realmName = Get-RequiredEnv "KEYCLOAK_REALM"

$googleClientId = Get-OptionalEnv "KEYCLOAK_GOOGLE_CLIENT_ID"
$googleClientSecret = Get-OptionalEnv "KEYCLOAK_GOOGLE_CLIENT_SECRET"
$githubClientId = Get-OptionalEnv "KEYCLOAK_GITHUB_CLIENT_ID"
$githubClientSecret = Get-OptionalEnv "KEYCLOAK_GITHUB_CLIENT_SECRET"

$token = Get-KeycloakToken `
    -AdminUrl $adminUrl `
    -Username $adminUsername `
    -Password $adminPassword
$headers = @{ Authorization = "Bearer $token" }

$googleConfigured = Upsert-IdentityProvider `
    -AdminUrl $adminUrl `
    -RealmName $realmName `
    -Headers $headers `
    -Alias "google" `
    -ProviderId "google" `
    -ClientId $googleClientId `
    -ClientSecret $googleClientSecret `
    -Config @{
        defaultScope = "openid profile email"
        useJwksUrl = "true"
    }

$githubConfigured = Upsert-IdentityProvider `
    -AdminUrl $adminUrl `
    -RealmName $realmName `
    -Headers $headers `
    -Alias "github" `
    -ProviderId "github" `
    -ClientId $githubClientId `
    -ClientSecret $githubClientSecret `
    -Config @{
        defaultScope = "user:email"
    }

Write-Host ""
Write-Host "Set these values in .env, then restart backend/frontend:"
Write-Host "KEYCLOAK_GOOGLE_ENABLED=$(if ($googleConfigured) { 'true' } else { 'false' })"
Write-Host "KEYCLOAK_GITHUB_ENABLED=$(if ($githubConfigured) { 'true' } else { 'false' })"
