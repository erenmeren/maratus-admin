# Ditto

**Ditto turns paper documents into scannable QR codes at the point of sale.**

## The problem

Stores hand out huge amounts of paper every day — receipts, warranty slips,
return forms, instructions. Customers lose them, staff reprint them, and the
paper itself is pure waste. The information was digital all along; printing it
was only ever a delivery problem.

## What Ditto does

Ditto replaces that piece of paper with a small touch-screen device that sits
on the counter. At the moment a store would have printed something, the device
shows a QR code instead. The customer points their phone camera at it and the
digital version opens instantly — nothing to install, nothing to type.

The content itself always stays with the business: Ditto never stores or even
sees what's behind the link. It simply tells the right device, at the right
moment, to display it. For businesses this means no customer data ever has to
leave their own systems.

## How it works

1. **Unbox.** A Ditto device arrives already registered to your store — each
   unit is tracked from the factory.
2. **Connect.** The installer joins it to the store Wi-Fi on the device's own
   screen. It recognizes itself and is ready — no codes to type, no accounts
   to create at the counter.
3. **Trigger.** When your point-of-sale or back-office system has something
   for the customer, it tells Ditto "show this link" — one simple request.
4. **Scan.** The QR code appears on the screen, the customer scans it, and the
   device returns to its branded idle screen.

## Who uses it

**Store chains** manage everything from a web panel: their stores, the devices
in each store, how the device screens look (logo, colors, layout), their team
members, and their credit balance.

**The Ditto operations team** has its own panel to look after customers, the
device fleet across all of them, the manufacturing inventory, and the software
that ships to devices.

## Pricing

Ditto uses prepaid credits. Each QR code successfully shown to a customer
costs one credit; if a display fails, nothing is charged. Store chains top up
their balance directly in the panel, and every new customer starts with a
credit grant to try the service.

## For developers

Setup, architecture, and API internals live in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). The device-facing protocol is
documented in [docs/device-protocol.md](docs/device-protocol.md).
