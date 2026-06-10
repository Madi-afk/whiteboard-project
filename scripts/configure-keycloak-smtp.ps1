param(
    [string]$EnvFile = ".env",
    [string]$TestUserEmail = ""
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
        [string]$Default
    )

    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $Default
    }

    return $value.Trim()
}

Import-DotEnv -Path $EnvFile

$adminUrl = (Get-RequiredEnv "KEYCLOAK_ADMIN_URL").TrimEnd("/")
$adminUsername = Get-RequiredEnv "KEYCLOAK_ADMIN_USERNAME"
$adminPassword = Get-RequiredEnv "KEYCLOAK_ADMIN_PASSWORD"
$realmName = Get-RequiredEnv "KEYCLOAK_REALM"
$clientId = Get-OptionalEnv "KEYCLOAK_CLIENT_ID" "whiteboard-frontend"
$redirectUri = Get-OptionalEnv "KEYCLOAK_REDIRECT_URI" "http://localhost:5173/auth"

$smtpHost = Get-RequiredEnv "KEYCLOAK_SMTP_HOST"
$smtpPort = Get-RequiredEnv "KEYCLOAK_SMTP_PORT"
$smtpFrom = Get-RequiredEnv "KEYCLOAK_SMTP_FROM"
$smtpFromName = Get-OptionalEnv "KEYCLOAK_SMTP_FROM_NAME" "Whiteboard"
$smtpUser = Get-OptionalEnv "KEYCLOAK_SMTP_USER" ""
$smtpPassword = Get-OptionalEnv "KEYCLOAK_SMTP_PASSWORD" ""
$smtpAuth = Get-OptionalEnv "KEYCLOAK_SMTP_AUTH" "true"
$smtpSsl = Get-OptionalEnv "KEYCLOAK_SMTP_SSL" "false"
$smtpStartTls = Get-OptionalEnv "KEYCLOAK_SMTP_STARTTLS" "true"

$tokenResponse = Invoke-RestMethod `
    -Method Post `
    -Uri "$adminUrl/realms/master/protocol/openid-connect/token" `
    -ContentType "application/x-www-form-urlencoded" `
    -Body @{
        client_id = "admin-cli"
        username = $adminUsername
        password = $adminPassword
        grant_type = "password"
    }

$headers = @{ Authorization = "Bearer $($tokenResponse.access_token)" }
$realm = Invoke-RestMethod -Uri "$adminUrl/admin/realms/$realmName" -Headers $headers

$smtpServer = [ordered]@{
    host = $smtpHost
    port = $smtpPort
    from = $smtpFrom
    fromDisplayName = $smtpFromName
    auth = $smtpAuth
    ssl = $smtpSsl
    starttls = $smtpStartTls
}

if ($smtpAuth -eq "true") {
    $smtpServer.user = $smtpUser
    $smtpServer.password = $smtpPassword
}

$realm.smtpServer = $smtpServer
$realm.verifyEmail = $true
$realm.registrationEmailAsUsername = $true
$realm.loginWithEmailAllowed = $true
$realm.duplicateEmailsAllowed = $false

$body = $realm | ConvertTo-Json -Depth 80
Invoke-RestMethod `
    -Method Put `
    -Uri "$adminUrl/admin/realms/$realmName" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body $body

Write-Host "Keycloak SMTP updated for realm '$realmName': ${smtpHost}:$smtpPort from $smtpFrom"

if (-not [string]::IsNullOrWhiteSpace($TestUserEmail)) {
    $encodedEmail = [uri]::EscapeDataString($TestUserEmail)
    $users = Invoke-RestMethod `
        -Uri "$adminUrl/admin/realms/$realmName/users?email=$encodedEmail&exact=true" `
        -Headers $headers

    if (-not $users -or $users.Count -eq 0) {
        throw "Cannot send test email: user '$TestUserEmail' was not found in Keycloak."
    }

    $userId = $users[0].id
    $actionsBody = ConvertTo-Json -InputObject @("VERIFY_EMAIL")
    $encodedRedirect = [uri]::EscapeDataString($redirectUri)
    Invoke-RestMethod `
        -Method Put `
        -Uri "$adminUrl/admin/realms/$realmName/users/$userId/execute-actions-email?client_id=$clientId&redirect_uri=$encodedRedirect" `
        -Headers $headers `
        -ContentType "application/json" `
        -Body $actionsBody

    Write-Host "Verification email sent to $TestUserEmail"
}
