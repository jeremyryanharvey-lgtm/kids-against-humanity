# Kids Against Humanity

A small, family-friendly multiplayer PWA prototype built for Cloudflare Workers and Durable Objects.

## Deploy
This repository is intended to be connected to Cloudflare Workers Builds. The deploy command is `npx wrangler deploy`; no build command is needed. Wrangler reads `wrangler.toml`, publishes the `public` assets, and creates the SQLite-backed Durable Object class.

## Important prototype notes
This is an early prototype, not a finished or safety-reviewed public game. Test with a few trusted devices first. It currently has basic room creation, joining, turn progression, and scoring. Before public use, add stronger room-code handling, reconnect/presence management, moderation and reporting, rate limits, more robust game validation, and a larger reviewed child-friendly card deck. Do not collect children's personal information; use nicknames.
