"use client";

import { useActionState, useState } from "react";
import { setBillingPlanAction, type PlanState } from "@/lib/actions/billing-plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const PLAN_LABELS: Record<string, string> = {
  credits: "Credits (prepaid, pay-as-you-go)",
  flat: "Flat Fleet (per-device, unlimited triggers)",
  base_usage: "Base + Usage (per-device base + included quota)",
};

const initialState: PlanState = { ok: true };

export function BillingPlanCard(props: {
  organizationId: string;
  billingPlan: string;
  includedTriggersPerDevice: number;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(setBillingPlanAction, initialState);
  const [plan, setPlan] = useState(props.billingPlan);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing plan</CardTitle>
        <CardDescription>
          Dual-track pricing: how this customer&apos;s triggers are paid.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="organizationId" value={props.organizationId} />
          <input type="hidden" name="billingPlan" value={plan} />
          <div className="space-y-1.5">
            <Label>Plan</Label>
            <Select value={plan} onValueChange={setPlan} disabled={props.disabled}>
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PLAN_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="includedTriggersPerDevice">Included triggers / device / month</Label>
            {plan === "base_usage" ? (
              <Input
                id="includedTriggersPerDevice"
                name="includedTriggersPerDevice"
                type="number"
                min={0}
                defaultValue={props.includedTriggersPerDevice}
                className="w-48"
                disabled={props.disabled}
              />
            ) : (
              <>
                <Input
                  id="includedTriggersPerDevice"
                  type="number"
                  min={0}
                  defaultValue={props.includedTriggersPerDevice}
                  className="w-48"
                  disabled
                />
                <input
                  type="hidden"
                  name="includedTriggersPerDevice"
                  value={props.includedTriggersPerDevice}
                />
              </>
            )}
          </div>
          <Button type="submit" disabled={pending || props.disabled}>
            {pending ? "Saving…" : "Save plan"}
          </Button>
          {!state.ok && state.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
