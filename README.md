# Gatekeeper

Gatekeeper is an app that helps enforce time-based restrictions on desktop applications. It provides policies to limit daily usage per app and an AI-assisted request flow to grant temporary access.

## Key Features

- Per-app daily limits
- Per-request max time and UI slider to request unlocks
- AI-assisted unlock requests (configurable Google Gemini API key)
- Automatic enforcement: launches and kills processes when restricted
- Persistent store for settings, tickets, and usage
- Notifications when apps are blocked or time expires

## Quick Start

**Option 1:** Install on Windows

Download the Gatekeeper Setup Installer from the latest release.

Run the installer and follow the prompts.

Launch Gatekeeper from the Start Menu.

Set the Google Gemini API key in the app settings (top right corner).

**Option 2:** Run from Source

Prereqs:
- Node.js 18+
- npm

Download source code as a zip file from release.

Install dependencies and run:

```bash
npm install
npm start
```
Set the Google Gemini API key in the app settings (top right corner).

## UI Overview

- Request Unlock: opens the chat-style request window where users select an app, choose minutes using a slider, and enter a short reason.
- Slider: capped by policy configuration and remaining daily minutes. If a daily cap exists, the slider max will be the smaller of the configured per-request max and the remaining minutes.
- Send: submits the request to the local AI assistant and, if approved, creates a temporary "ticket" that grants access for the specified time.
- Settings: configure policies, blocked apps, and set the Chatbot API key.

## Policies

Policies are configured per app and include:
- `dailyMaxMinutes`: total minutes allowed per local day (0 = unlimited)
- `maxUnlockMinutesPerRequest`: maximum minutes that can be granted in a single request

