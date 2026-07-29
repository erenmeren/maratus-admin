// components/admin/mqtt-health-card.tsx
// Per-channel MQTT webhook liveness. EMQX's rules API 403s on namespaced keys,
// so a rule's action type can't be checked from code — one silent channel beside
// its talking siblings is the tell for a Republish-instead-of-HTTP-Server rule.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MQTT_CHANNELS, channelHealth, getWebhookPings } from "@/lib/mqtt-ping";

const LABEL: Record<string, string> = {
  ack: "Command acks",
  heartbeat: "Heartbeats",
  presence: "Presence",
  "config-request": "Config requests",
};

export async function MqttHealthCard() {
  const pings = await getWebhookPings();
  const byChannel = new Map(pings.map((p) => [p.channel, p]));
  const now = new Date();

  return (
    <Card>
      <CardHeader>
        <CardTitle>MQTT channels</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {MQTT_CHANNELS.map((ch) => {
          const p = byChannel.get(ch) ?? null;
          const health = channelHealth(p?.lastAt ?? null, now);
          return (
            <div key={ch} className="flex items-center justify-between gap-4 text-sm">
              <span>{LABEL[ch]}</span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">
                  {p?.lastAt
                    ? `${p.lastAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
                    : "never"}
                </span>
                <Badge variant={health === "ok" ? "secondary" : "destructive"}>
                  {health === "ok" ? "live" : health === "stale" ? "silent" : "never seen"}
                </Badge>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
