# Blockscope

Blockscope is a small Roblox public-profile lookup. Search by username to view the account's public display name, profile description, join date, avatar, public presence when Roblox provides it, and Roblox profile link. You can also save profiles in this browser and request a public friends list.

The browser requests the local `GET /api/roblox/profile?username=...` endpoint. A small Vite middleware calls Roblox's public endpoints server-side, avoiding browser cross-origin restrictions:

- `POST https://users.roblox.com/v1/usernames/users` to find the user ID.
- `GET https://users.roblox.com/v1/users/{userId}` to load public profile details.
- `GET https://thumbnails.roblox.com/v1/users/avatar` to load the public avatar thumbnail.
- `POST https://presence.roblox.com/v1/presence/users` to read public online status and, when Roblox provides it, the current experience.
- The same presence endpoint is polled every 30 seconds while a profile is open to keep the displayed public status current.
- `GET https://friends.roblox.com/v1/users/{userId}/friends` to request a publicly available friends list.
- `GET https://friends.roblox.com/v1/users/{userId}/friends/count` to request the public friends count.

Feedback is sent by the server directly to `avakinyuro@gmail.com` via Gmail SMTP. Configure `SMTP_USER` and a Google App Password as `SMTP_PASS` in `.env`; credentials remain on the server and are never exposed to the browser.

The middleware is available in Vite development and preview servers. A static production deployment does not include a server API; deploy the API middleware on a server or serverless function and configure the frontend to use it.

Bookmarks are stored in the browser's local storage on the current device. Roblox may hide or restrict presence and friends data; in that case, the app reports that the information is unavailable. When Roblox provides a friends count but not the list, the app can still display the total. Roblox's public APIs do not expose a user's past-game history or hours played. Presence is a point-in-time status and may change.

It does not ask for, collect, or display passwords, login cookies, email addresses, or other private account credentials. Roblox passwords are private; use Roblox's official account recovery and support flows for accounts you own or are authorized to help recover.

## Run locally

```sh
npm install
npm run dev
```

The app requires an internet connection to contact Roblox. API availability and browser access are controlled by Roblox.

## Feedback email setup

1. Enable 2-Step Verification for `avakinyuro@gmail.com` and create a Google App Password for that account.
2. Copy `.env.example` to `.env`. Keep `SMTP_USER=avakinyuro@gmail.com` and set `SMTP_PASS` to the generated App Password (not the regular Gmail password).
3. Keep `.env` private; it is excluded from Git. Restart the Vite server after changing environment variables.

Feedback is delivered to `avakinyuro@gmail.com`. The feedback form does not request or include the sender's email address. The endpoint limits each client IP to three submissions per ten minutes per server instance. Configure the same secrets in your production server environment; static hosting alone cannot send email.

## Build

```sh
npm run build
```
