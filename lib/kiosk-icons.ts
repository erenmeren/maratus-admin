"use client";

import {
  Check, CheckCircle2, Heart, Star, Gift, Mail, ThumbsUp, Smile, Clock, Bell,
  AlertTriangle, WifiOff, Sparkles, PartyPopper, BadgeCheck, Coffee,
  type LucideIcon,
} from "lucide-react";
import { ICON_PRESETS, DEFAULT_ICON_PRESET, type IconPreset } from "./kiosk-layout";

export const ICON_COMPONENTS: Record<IconPreset, LucideIcon> = {
  "check": Check,
  "check-circle": CheckCircle2,
  "heart": Heart,
  "star": Star,
  "gift": Gift,
  "mail": Mail,
  "thumbs-up": ThumbsUp,
  "smile": Smile,
  "clock": Clock,
  "bell": Bell,
  "alert-triangle": AlertTriangle,
  "wifi-off": WifiOff,
  "sparkles": Sparkles,
  "party-popper": PartyPopper,
  "badge-check": BadgeCheck,
  "coffee": Coffee,
};

/** Resolve a stored preset name to a lucide component, defaulting safely. */
export function resolveIconComponent(name: string | undefined): LucideIcon {
  if (name && (ICON_PRESETS as readonly string[]).includes(name)) {
    return ICON_COMPONENTS[name as IconPreset];
  }
  return ICON_COMPONENTS[DEFAULT_ICON_PRESET];
}
