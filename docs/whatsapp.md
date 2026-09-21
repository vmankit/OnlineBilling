# WhatsApp in Santu Hardware

## What the app does today

Every WhatsApp button builds a **`wa.me` link** — WhatsApp's own documented
format. Tapping it opens WhatsApp (the app on iPad and phone, web on desktop)
with the customer's chat and the message already typed. The shopkeeper reads it
and presses send.

There is no account to link and no session to keep alive. It works offline-ish,
survives a restart, and cannot get the shop's number banned.

All link building goes through `frontend/src/features/whatsapp/whatsapp.ts`.
Never build a `wa.me` URL by hand — the number normalisation is the part that
goes wrong (see below).

## The number normalisation trap

`wa.me` needs a full international number: country code, no `+`, no spaces.

The obvious way to add the country code is wrong:

```ts
// WRONG — drops the country code from perfectly valid numbers
const num = digits.startsWith('91') ? digits : `91${digits}`;
```

A normal 10-digit Indian mobile can itself start with `91`. The shop has such a
customer: **9123456780**. The check above decides the country code is already
there, produces `wa.me/9123456780`, and the link dies.

`normalizeIndianMobile()` decides by **length**, not prefix, and also handles
the trunk zero (`09835012345`), the international prefix (`0091…`), and numbers
that already carry a foreign country code. It returns `null` when it cannot
understand the input, and `buildWaLink()` then opens WhatsApp *without* a
recipient so the operator picks the chat — better than a dead one.

## What would be needed to send automatically

Sending without a human pressing send is a completely different thing. Two
routes exist, and only one is legitimate:

### Official — WhatsApp Business Cloud API

Requires all of:

- a Meta Business account with the business verified,
- a phone number dedicated to the API (that number can no longer be used in the
  normal WhatsApp app on a handset),
- message **templates** submitted to Meta and approved, because a business may
  not start a conversation with free-form text,
- per-conversation pricing.

This is implementable — a server-side `POST` to the Cloud API with the template
name and variables — but it cannot be switched on from the code alone. It needs
the shop's Meta credentials and approved templates first. Nothing in the app
pretends this is connected.

### Unofficial — do not use

Libraries that drive WhatsApp Web by scanning a QR code from "Linked Devices"
(whatsapp-web.js, Baileys and similar) are **not** sanctioned by WhatsApp. They
breach the terms of service and get numbers banned — which for this shop means
losing the number customers already have.

The old "WhatsApp Connect" screen showed a decorative QR icon, the Linked
Devices instructions, and a button labelled *Simulate Connected* that flipped a
boolean. It connected nothing, and the route it implied is the one to avoid.
It has been replaced by the message composer.
