import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  formatDueDate,
  emailLayout,
  invoiceSentEmail,
  paymentFailedEmail,
  paidReceiptEmail,
  overdueReminderEmail,
  type InvoiceEmailData,
} from "./invoice-emails";

const base: InvoiceEmailData = {
  orgName: "Roastwell Coffee",
  periodLabel: "Jun 2026",
  amountDollars: 49.6,
  payUrl: "https://pay.stripe.com/abc",
  dueDateLabel: "July 14, 2026",
};

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("formatDueDate", () => {
  it("formats as 'Month D, YYYY' in UTC", () => {
    expect(formatDueDate(new Date("2026-07-14T00:00:00Z"))).toBe("July 14, 2026");
  });
});

describe("emailLayout", () => {
  it("wraps the body with the Ditto wordmark", () => {
    const html = emailLayout("<p>hi</p>");
    expect(html).toContain("Ditto");
    expect(html).toContain("<p>hi</p>");
  });
});

describe("invoice email builders", () => {
  it("invoiceSentEmail: subject names the period, body has amount + pay link", () => {
    const { subject, html } = invoiceSentEmail(base);
    expect(subject).toBe("Your Ditto invoice for Jun 2026");
    expect(html).toContain("$49.60");
    expect(html).toContain("https://pay.stripe.com/abc");
  });

  it("paymentFailedEmail: subject signals failure, body has the update-payment link", () => {
    const { subject, html } = paymentFailedEmail(base);
    expect(subject).toBe("Payment failed for your Ditto invoice");
    expect(html).toContain("https://pay.stripe.com/abc");
    expect(html).toContain("$49.60");
  });

  it("paidReceiptEmail: confirmation with amount and NO pay link", () => {
    const { subject, html } = paidReceiptEmail(base);
    expect(subject).toBe("Payment received — Jun 2026");
    expect(html).toContain("$49.60");
    expect(html).not.toContain("https://pay.stripe.com/abc");
  });

  it("overdueReminderEmail: subject signals overdue, body has the pay link", () => {
    const { subject, html } = overdueReminderEmail(base);
    expect(subject).toBe("Your Ditto invoice is overdue");
    expect(html).toContain("https://pay.stripe.com/abc");
  });

  it("escapes a malicious org name in every builder", () => {
    const evil = { ...base, orgName: `<script>alert(1)</script>` };
    for (const build of [invoiceSentEmail, paymentFailedEmail, paidReceiptEmail, overdueReminderEmail]) {
      const { html } = build(evil);
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;");
    }
  });
});
