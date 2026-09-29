ALTER TABLE "member" ADD COLUMN "invited_by_id" text;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_invited_by_id_user_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: attribute existing members to the inviter of the latest accepted
-- invitation for the same org + email.
UPDATE "member" m SET "invited_by_id" = i."inviter_id"
FROM (
  SELECT DISTINCT ON (inv."organization_id", lower(inv."email"))
    inv."organization_id", lower(inv."email") AS email, inv."inviter_id"
  FROM "invitation" inv
  WHERE inv."status" = 'accepted'
  ORDER BY inv."organization_id", lower(inv."email"), inv."created_at" DESC
) i, "user" u
WHERE u."id" = m."user_id"
  AND i."organization_id" = m."organization_id"
  AND i.email = lower(u."email")
  AND m."invited_by_id" IS NULL;
