---
name: himalaya
description: "CLI to manage emails via IMAP/SMTP. Use `himalaya` to list, read, write, reply, forward, search, and organize emails from the terminal. Supports multiple accounts and message composition with MML (MIME Meta Language)."
homepage: https://github.com/pimalaya/himalaya
metadata:
  {
    "openclaw":
      {
        "emoji": "📧",
        "requires": { "bins": ["himalaya"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "himalaya",
              "bins": ["himalaya"],
              "label": "Install Himalaya (brew)",
            },
          ],
      },
  }
---

# Himalaya Email CLI

Himalaya is a CLI email client that lets you manage emails from the terminal using IMAP, SMTP, Notmuch, or Sendmail backends.

## IMPORTANT: Binary and OAuth2

The himalaya binary at `~/.cargo/bin/himalaya` (also symlinked to `~/.npm-global/bin/himalaya`) is compiled with **+oauth2** support. Do NOT use the Homebrew version — it lacks oauth2.

Verify with: `himalaya --version` — output must include `+oauth2`.

**Do NOT attempt to recompile himalaya.** The working binary is already installed.

## Outlook OAuth2 (ACTIVE)

Outlook email is fully configured and working via OAuth2. Config: `~/.config/himalaya/config.toml`

To read emails, just run:

```bash
himalaya envelope list
```

If you see "authentication failed, refreshing access token", that is normal — himalaya auto-refreshes the token via keyring and retries successfully.

## References

- `references/configuration.md` (config file setup + IMAP/SMTP/OAuth2 authentication)
- `references/message-composition.md` (MML syntax for composing emails)

## Prerequisites

1. Himalaya CLI installed with +oauth2 (`himalaya --version` to verify)
2. A configuration file at `~/.config/himalaya/config.toml`
3. OAuth2 tokens stored in system keyring (already configured for Outlook)

## Configuration Setup

Run the interactive wizard to set up an account:

```bash
himalaya account configure
```

Or create `~/.config/himalaya/config.toml` manually.

### Password auth example:

```toml
[accounts.personal]
email = "you@example.com"
display-name = "Your Name"
default = true

backend.type = "imap"
backend.host = "imap.example.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "you@example.com"
backend.auth.type = "password"
backend.auth.cmd = "pass show email/imap"  # or use keyring

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.example.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
message.send.backend.login = "you@example.com"
message.send.backend.auth.type = "password"
message.send.backend.auth.cmd = "pass show email/smtp"
```

### OAuth2 auth example (Outlook):

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

## Common Operations

### List Folders

```bash
himalaya folder list
```

### List Emails

List emails in INBOX (default):

```bash
himalaya envelope list
```

List emails in a specific folder:

```bash
himalaya envelope list --folder "Sent"
```

List with pagination:

```bash
himalaya envelope list --page 1 --page-size 20
```

### Search Emails

```bash
himalaya envelope list from john@example.com subject meeting
```

### Read an Email

Read email by ID (shows plain text):

```bash
himalaya message read 42
```

Export raw MIME:

```bash
himalaya message export 42 --full
```

### Reply to an Email

Interactive reply (opens $EDITOR):

```bash
himalaya message reply 42
```

Reply-all:

```bash
himalaya message reply 42 --all
```

### Forward an Email

```bash
himalaya message forward 42
```

### Write a New Email

Interactive compose (opens $EDITOR):

```bash
himalaya message write
```

Send directly using template:

```bash
cat << 'EOF' | himalaya template send
From: you@example.com
To: recipient@example.com
Subject: Test Message

Hello from Himalaya!
EOF
```

Or with headers flag:

```bash
himalaya message write -H "To:recipient@example.com" -H "Subject:Test" "Message body here"
```

### Save a Draft

Save a message to the Drafts folder without sending:

```bash
cat << 'EOF' | himalaya message save --folder "Drafts"
From: zachary_aw@outlook.sg
To: recipient@example.com
Subject: Draft Subject

Draft message body here.
EOF
```

This saves the raw MIME message to the Drafts folder via IMAP. The draft will appear in Outlook's Drafts folder ready for editing/sending.

### Move/Copy Emails

Move to folder:

```bash
himalaya message move 42 "Archive"
```

Copy to folder:

```bash
himalaya message copy 42 "Important"
```

### Delete an Email

```bash
himalaya message delete 42
```

### Manage Flags

Add flag:

```bash
himalaya flag add 42 --flag seen
```

Remove flag:

```bash
himalaya flag remove 42 --flag seen
```

## Multiple Accounts

List accounts:

```bash
himalaya account list
```

Use a specific account:

```bash
himalaya --account work envelope list
```

## Attachments

Save attachments from a message:

```bash
himalaya attachment download 42
```

Save to specific directory:

```bash
himalaya attachment download 42 --dir ~/Downloads
```

## Output Formats

Most commands support `--output` for structured output:

```bash
himalaya envelope list --output json
himalaya envelope list --output plain
```

## Debugging

Enable debug logging:

```bash
RUST_LOG=debug himalaya envelope list
```

Full trace with backtrace:

```bash
RUST_LOG=trace RUST_BACKTRACE=1 himalaya envelope list
```

## Tips

- Use `himalaya --help` or `himalaya <command> --help` for detailed usage.
- Message IDs are relative to the current folder; re-list after folder changes.
- For composing rich emails with attachments, use MML syntax (see `references/message-composition.md`).
- Store passwords securely using `pass`, system keyring, or a command that outputs the password.
