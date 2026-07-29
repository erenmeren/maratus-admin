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

function ChannelRow({
  channel,
  lastAt,
  now,
}: {
  channel: string;
  lastAt: Date | null;
  now: Date;
}) {
  const health = channelHealth(lastAt, now);
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span>{LABEL[channel]}</span>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">
          {lastAt ? `${lastAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "never"}
        </span>
        <Badge variant={health === "ok" ? "secondary" : "destructive"}>
          {health === "ok" ? "live" : health === "stale" ? "silent" : "never seen"}
        </Badge>
      </div>
    </div>
  );
}

export async function MqttHealthCard() {
  const pings = await getWebhookPings();
  const now = new Date();
  const byChannel = new Map(pings?.map((p) => [p.channel, p]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>MQTT channels</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {pings === null ? (
          <p className="text-sm text-muted-foreground">
            Channel telemetry is unavailable right now.
          </p>
        ) : (
          MQTT_CHANNELS.map((ch) => (
            <ChannelRow key={ch} channel={ch} lastAt={byChannel.get(ch)?.lastAt ?? null} now={now} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
