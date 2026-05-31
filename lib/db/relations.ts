// Drizzle relations for the relational query API (db.query.*).
// Kept separate from schema.ts so the schema stays declaration-only.

import { relations } from "drizzle-orm";
import {
  account,
  device,
  invitation,
  invoice,
  member,
  organization,
  receipt,
  session,
  store,
  tenantSettings,
  user,
} from "./schema";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  memberships: many(member),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const organizationRelations = relations(organization, ({ one, many }) => ({
  members: many(member),
  invitations: many(invitation),
  settings: one(tenantSettings, {
    fields: [organization.id],
    references: [tenantSettings.organizationId],
  }),
  stores: many(store),
  devices: many(device),
  receipts: many(receipt),
  invoices: many(invoice),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, { fields: [member.userId], references: [user.id] }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  inviter: one(user, { fields: [invitation.inviterId], references: [user.id] }),
}));

export const tenantSettingsRelations = relations(tenantSettings, ({ one }) => ({
  organization: one(organization, {
    fields: [tenantSettings.organizationId],
    references: [organization.id],
  }),
}));

export const storeRelations = relations(store, ({ one, many }) => ({
  organization: one(organization, {
    fields: [store.organizationId],
    references: [organization.id],
  }),
  devices: many(device),
}));

export const deviceRelations = relations(device, ({ one, many }) => ({
  organization: one(organization, {
    fields: [device.organizationId],
    references: [organization.id],
  }),
  store: one(store, { fields: [device.storeId], references: [store.id] }),
  receipts: many(receipt),
}));

export const receiptRelations = relations(receipt, ({ one }) => ({
  organization: one(organization, {
    fields: [receipt.organizationId],
    references: [organization.id],
  }),
  device: one(device, { fields: [receipt.deviceId], references: [device.id] }),
  store: one(store, { fields: [receipt.storeId], references: [store.id] }),
}));

export const invoiceRelations = relations(invoice, ({ one }) => ({
  organization: one(organization, {
    fields: [invoice.organizationId],
    references: [organization.id],
  }),
}));
