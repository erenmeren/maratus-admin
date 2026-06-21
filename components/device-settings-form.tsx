"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { saveDeviceSettings } from "@/app/(tenant)/tenant/device-settings/actions";
import type { TenantDeviceSettings } from "@/lib/data";

const SLEEP_TIMEOUT_OPTIONS = [
  { label: "30 seconds", value: 30 },
  { label: "1 minute", value: 60 },
  { label: "2 minutes", value: 120 },
  { label: "5 minutes", value: 300 },
  { label: "10 minutes", value: 600 },
  { label: "15 minutes", value: 900 },
  { label: "30 minutes", value: 1800 },
  { label: "60 minutes", value: 3600 },
];

export function DeviceSettingsForm({
  initial,
  canEdit,
}: {
  initial: TenantDeviceSettings;
  canEdit: boolean;
}) {
  const [qr, setQr] = React.useState(initial.qrVisibleSeconds);
  const [brightness, setBrightness] = React.useState(initial.screenBrightness);
  const [sleepEnabled, setSleepEnabled] = React.useState(initial.screenSleepEnabled);
  const [sleepTimeout, setSleepTimeout] = React.useState(initial.screenSleepTimeoutSeconds);
  const [password, setPassword] = React.useState("");
  const [clearPassword, setClearPassword] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const disabled = !canEdit || saving;

  const dirty =
    qr !== initial.qrVisibleSeconds ||
    brightness !== initial.screenBrightness ||
    sleepEnabled !== initial.screenSleepEnabled ||
    sleepTimeout !== initial.screenSleepTimeoutSeconds ||
    password.length > 0 ||
    clearPassword;

  function reset() {
    setQr(initial.qrVisibleSeconds);
    setBrightness(initial.screenBrightness);
    setSleepEnabled(initial.screenSleepEnabled);
    setSleepTimeout(initial.screenSleepTimeoutSeconds);
    setPassword("");
    setClearPassword(false);
  }

  async function save() {
    if (password && !/^[0-9]{4,12}$/.test(password.trim())) {
      toast.error("PIN must be 4–12 digits.");
      return;
    }
    setSaving(true);
    const fd = new FormData();
    fd.set("qrVisibleSeconds", String(qr));
    fd.set("screenBrightness", String(brightness));
    fd.set("screenSleepEnabled", String(sleepEnabled));
    fd.set("screenSleepTimeoutSeconds", String(sleepTimeout));
    if (clearPassword) fd.set("clearPassword", "true");
    else if (password) fd.set("password", password.trim());

    const res = await saveDeviceSettings(fd);
    setSaving(false);
    if (res.ok) {
      toast.success("Device settings saved. Devices will update on next check-in.");
      // Reflect saved state locally without a full reload.
      window.location.reload();
    } else {
      toast.error(res.error ?? "Couldn't save device settings.");
    }
  }

  const hasPassword = initial.hasPassword && !clearPassword;

  return (
    <div className="space-y-6 pb-24">
      {/* QR visible duration */}
      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <Label>QR code visible for</Label>
          <span className="text-sm tabular-nums text-muted-foreground">{qr}s</span>
        </div>
        <Slider
          min={15}
          max={180}
          step={5}
          value={[qr]}
          onValueChange={([v]) => setQr(v)}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          How long the receipt QR code stays on screen before the device returns to idle (15–180s).
        </p>
      </Card>

      {/* Brightness */}
      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <Label>Screen brightness</Label>
          <span className="text-sm tabular-nums text-muted-foreground">{brightness}%</span>
        </div>
        <Slider
          min={10}
          max={100}
          step={1}
          value={[brightness]}
          onValueChange={([v]) => setBrightness(v)}
          disabled={disabled}
        />
      </Card>

      {/* Sleep */}
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>Screen sleep</Label>
            <p className="text-xs text-muted-foreground">
              Turn the display off after inactivity. The device stays online and wakes on touch
              or when a new receipt prints.
            </p>
          </div>
          <Switch checked={sleepEnabled} onCheckedChange={setSleepEnabled} disabled={disabled} />
        </div>
        {sleepEnabled && (
          <div className="flex items-center justify-between gap-4">
            <Label className="text-sm font-normal text-muted-foreground">Sleep after</Label>
            <Select
              value={String(sleepTimeout)}
              onValueChange={(v) => setSleepTimeout(Number(v))}
              disabled={disabled}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SLEEP_TIMEOUT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </Card>

      {/* Settings PIN */}
      <Card className="space-y-3 p-5">
        <Label>Device Settings PIN</Label>
        <p className="text-xs text-muted-foreground">
          {hasPassword
            ? "A PIN is set. Enter a new one to change it, or remove it to leave the on-device Settings page unlocked."
            : "Set a 4–12 digit PIN to lock the device's on-screen Settings page. Leave blank to keep it unlocked."}
        </p>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder={hasPassword ? "Enter new PIN to change" : "Set a PIN"}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (e.target.value) setClearPassword(false);
          }}
          disabled={disabled || clearPassword}
        />
        {initial.hasPassword && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={clearPassword}
              onChange={(e) => {
                setClearPassword(e.target.checked);
                if (e.target.checked) setPassword("");
              }}
              disabled={disabled}
            />
            Remove PIN (leave Settings page unlocked)
          </label>
        )}
      </Card>

      {/* Sticky save bar (mirrors Branding) */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-6 py-3 backdrop-blur sm:left-[var(--sidebar-width,0)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className={cn("size-2 rounded-full", dirty ? "bg-amber-500" : "bg-emerald-500")} />
            {!canEdit ? "Read only" : dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={reset} disabled={disabled || !dirty}>
              Reset
            </Button>
            <Button onClick={save} disabled={disabled || !dirty}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
