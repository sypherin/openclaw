# Device Pairing Plugin

This plugin adds a `/pair` command that helps you pair a new node device to an OpenClaw gateway.

## Enable

Bundled plugins are disabled by default. Enable this plugin with:

```bash
openclaw plugins enable device-pair
```

## Usage

In any authorized control chat, run:

```text
/pair
```

Then connect the new node device to the gateway using the host/port/TLS + token/password shown.

Approve the pairing request:

```text
/pair approve
```

Other commands:

```text
/pair pending
/pair reject [requestId]
```
