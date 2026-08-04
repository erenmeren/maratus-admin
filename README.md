# Ditto

**Ditto is a retail customer interaction platform: a programmable screen at the
counter that becomes the digital bridge between a business and its customer at
the final step of an in-store visit.**

## The idea

Today, the last thing most stores hand a customer is a piece of paper — a
receipt, a warranty slip, a return form. But the paper was never the point;
it was only ever a delivery mechanism for something digital.

Ditto replaces that moment with a small touch-screen device that works like the
**physical equivalent of a web browser**. A browser doesn't care whether it
renders a video site or a mail client — and Ditto doesn't care whether it
delivers:

- a receipt or warranty
- a loyalty card or coupon
- a survey or rating request
- a menu or product manual
- a repair booking, digital ticket, or event pass

The business decides what the customer sees. Ditto simply puts it on the screen
at exactly the right moment, and the customer's phone takes it from there —
nothing to install, nothing to type.

## Private by architecture

Ditto is intentionally **stateless**. It never stores customer information,
receipts, transaction history, or payment data. The business hosts its own
content and passes Ditto a link; the device displays it, the customer's phone
talks **directly to the business's systems**, and Ditto discards the
interaction when it expires. Ditto is never a proxy and never owns customer
data — which also means there is almost nothing to review when a security or
privacy team looks at it.

## How it works

1. **Unbox.** A Ditto device arrives already registered to your store — each
   unit is tracked from the factory.
2. **Connect.** The installer joins it to the store Wi-Fi on the device's own
   screen. It recognizes itself and is ready — no codes to type, no accounts
   to create at the counter.
3. **Trigger.** When your point-of-sale, CRM, loyalty, or booking system has
   something for the customer, it tells Ditto "show this" — one simple API
   request. Screens can also hold a **pinned** experience (a menu, a Wi-Fi
   link, a campaign) that stays up until you change it — centrally, for one
   device, one store, or the whole chain at once.
4. **Scan.** The QR code appears on the screen, the customer scans it, and the
   device returns to its branded idle screen.

The screen itself is the first Ditto endpoint, not the product: the product is
the **Experience API** that lets any business system reach the customer at the
counter. Richer interaction types and hardware (NFC, camera, audio) can build
on the same platform without changing the model.

## Who uses it

**Businesses** — from a single café to a multi-thousand-store chain — manage
everything from a web panel: stores, the devices in each store, how the device
screens look (logo, colors, layout, per-screen themes), pinned experiences,
team members, and billing.

**The Ditto operations team** has its own panel to look after customers, the
device fleet across all of them, the manufacturing inventory, and the software
that ships to devices over the air.

## Pricing

Ditto uses prepaid credits. Each interaction successfully shown to a customer
costs one credit; if a display fails, nothing is charged. Businesses top up
their balance directly in the panel, and every new customer starts with a
credit grant to try the service. Per-device subscription plans exist for
fleet-scale deployments.

## For developers

Setup, architecture, and API internals live in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). The device-facing protocol is
documented in [docs/device-protocol.md](docs/device-protocol.md).
