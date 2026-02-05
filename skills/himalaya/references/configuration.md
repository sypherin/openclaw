# Himalaya Configuration Reference

Configuration file location: `~/.config/himalaya/config.toml`

## Minimal IMAP + SMTP Setup

```toml
[accounts.default]
email = "user@example.com"
display-name = "Your Name"
default = true

# IMAP backend for reading emails
backend.type = "imap"
backend.host = "imap.example.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "user@example.com"
backend.auth.type = "password"
backend.auth.raw = "your-password"

# SMTP backend for sending emails
message.send.backend.type = "smtp"
message.send.backend.host = "smtp.example.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
message.send.backend.login = "user@example.com"
message.send.backend.auth.type = "password"
message.send.backend.auth.raw = "your-password"
```

## Password Options

### Raw password (testing only, not recommended)

```toml
backend.auth.raw = "your-password"
```

### Password from command (recommended)

```toml
backend.auth.cmd = "pass show email/imap"
# backend.auth.cmd = "security find-generic-password -a user@example.com -s imap -w"
```

### System keyring (requires keyring feature)

```toml
backend.auth.keyring = "imap-example"
```

Then run `himalaya account configure <account>` to store the password.

## Gmail Configuration

```toml
[accounts.gmail]
email = "you@gmail.com"
display-name = "Your Name"
default = true

backend.type = "imap"
backend.host = "imap.gmail.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "you@gmail.com"
backend.auth.type = "password"
backend.auth.cmd = "pass show google/app-password"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.gmail.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
message.send.backend.login = "you@gmail.com"
message.send.backend.auth.type = "password"
message.send.backend.auth.cmd = "pass show google/app-password"
```

**Note:** Gmail requires an App Password if 2FA is enabled.

## iCloud Configuration

```toml
[accounts.icloud]
email = "you@icloud.com"
display-name = "Your Name"

backend.type = "imap"
backend.host = "imap.mail.me.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "you@icloud.com"
backend.auth.type = "password"
backend.auth.cmd = "pass show icloud/app-password"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.mail.me.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
message.send.backend.login = "you@icloud.com"
message.send.backend.auth.type = "password"
message.send.backend.auth.cmd = "pass show icloud/app-password"
```

**Note:** Generate an app-specific password at appleid.apple.com

## Folder Aliases

Map custom folder names:

```toml
[accounts.default.folder.alias]
inbox = "INBOX"
sent = "Sent"
drafts = "Drafts"
trash = "Trash"
```

## Multiple Accounts

```toml
[accounts.personal]
email = "personal@example.com"
default = true
# ... backend config ...

[accounts.work]
email = "work@company.com"
# ... backend config ...
```

Switch accounts with `--account`:

```bash
himalaya --account work envelope list
```

## Notmuch Backend (local mail)

```toml
[accounts.local]
email = "user@example.com"

backend.type = "notmuch"
backend.db-path = "~/.mail/.notmuch"
```

## OAuth2 Authentication

**Requires:** himalaya compiled with `+oauth2` feature. Verify: `himalaya --version` must show `+oauth2`.

**IMPORTANT:** On this machine, the correct binary is at `~/.cargo/bin/himalaya` (symlinked to `~/.npm-global/bin/himalaya`). Do NOT use the Homebrew build — it lacks oauth2. Do NOT recompile.

### Outlook / Microsoft 365 (XOAUTH2 + PKCE)

```toml
[accounts.outlook]
email = "you@outlook.com"
display-name = "Your Name"
default = true

backend.type = "imap"
backend.host = "outlook.office365.com"
backend.port = 993
backend.login = "you@outlook.com"
backend.encryption.type = "tls"
backend.auth.type = "oauth2"
backend.auth.method = "xoauth2"
backend.auth.client-id = "your-azure-app-client-id"
backend.auth.auth-url = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"
backend.auth.token-url = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
backend.auth.scopes = ["https://outlook.office.com/IMAP.AccessAsUser.All", "offline_access"]
backend.auth.pkce = true
backend.auth.redirect-host = "localhost"
backend.auth.redirect-port = 9999
backend.auth.access-token.keyring = "outlook-imap-access"
backend.auth.refresh-token.keyring = "outlook-imap-refresh"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.office365.com"
message.send.backend.port = 587
message.send.backend.login = "you@outlook.com"
message.send.backend.encryption.type = "start-tls"
message.send.backend.auth.type = "oauth2"
message.send.backend.auth.method = "xoauth2"
message.send.backend.auth.client-id = "your-azure-app-client-id"
message.send.backend.auth.auth-url = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"
message.send.backend.auth.token-url = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
message.send.backend.auth.scopes = ["https://outlook.office.com/SMTP.Send", "offline_access"]
message.send.backend.auth.pkce = true
message.send.backend.auth.redirect-host = "localhost"
message.send.backend.auth.redirect-port = 9999
message.send.backend.auth.access-token.keyring = "outlook-smtp-access"
message.send.backend.auth.refresh-token.keyring = "outlook-smtp-refresh"
```

Token refresh is automatic — himalaya reads the refresh token from the system keyring, exchanges it with Microsoft's token endpoint, and stores the new access token back. The "authentication failed, refreshing access token" warning is normal.

### Generic OAuth2

```toml
backend.auth.type = "oauth2"
backend.auth.client-id = "your-client-id"
backend.auth.client-secret.cmd = "pass show oauth/client-secret"
backend.auth.access-token.cmd = "pass show oauth/access-token"
backend.auth.refresh-token.cmd = "pass show oauth/refresh-token"
backend.auth.auth-url = "https://provider.com/oauth/authorize"
backend.auth.token-url = "https://provider.com/oauth/token"
```

## Additional Options

### Signature

```toml
[accounts.default]
signature = "Best regards,\nYour Name"
signature-delim = "-- \n"
```

### Downloads directory

```toml
[accounts.default]
downloads-dir = "~/Downloads/himalaya"
```

### Editor for composing

Set via environment variable:

```bash
export EDITOR="vim"
```
