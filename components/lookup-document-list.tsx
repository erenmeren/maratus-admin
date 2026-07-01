import Link from "next/link";
import { RotateCcw, ShieldCheck, FileText } from "lucide-react";
import { coverageStatus } from "@/lib/branding/coverage";

export function LookupDocumentList({
  email,
  documents,
}: {
  email: string;
  documents: Array<{
    token: string;
    createdAt: Date;
    returnWindowDays: number | null;
    warrantyPeriodMonths: number | null;
  }>;
}) {
  return (
    <>
      <div className="border-b px-6 py-6 text-center">
        <h1 className="font-display text-lg font-bold">Your documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">{email}</p>
      </div>

      {documents.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FileText className="size-6" />
          </span>
          <p className="text-sm text-muted-foreground">No saved documents yet.</p>
        </div>
      ) : (
        <ul className="divide-y">
          {documents.map((doc) => {
            const coverage = coverageStatus(
              {
                createdAt: doc.createdAt,
                returnWindowDays: doc.returnWindowDays,
                warrantyPeriodMonths: doc.warrantyPeriodMonths,
              },
              new Date(),
            );
            const dateStr = doc.createdAt.toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            });

            return (
              <li key={doc.token} className="px-6 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm font-medium">{dateStr}</p>
                    {coverage.show && (
                      <div className="space-y-1 text-xs">
                        {coverage.return && (
                          <p className="flex items-center gap-1.5">
                            <RotateCcw
                              className="size-3.5 shrink-0"
                              style={{ color: coverage.return.expired ? undefined : "#10A765" }}
                            />
                            {coverage.return.expired ? (
                              <span className="text-muted-foreground">
                                Return period ended (was{" "}
                                {coverage.return.untilDate.toLocaleDateString("en-US", {
                                  dateStyle: "medium",
                                })}
                                )
                              </span>
                            ) : (
                              <span className="font-medium" style={{ color: "#10A765" }}>
                                Returns accepted until{" "}
                                {coverage.return.untilDate.toLocaleDateString("en-US", {
                                  dateStyle: "medium",
                                })}
                              </span>
                            )}
                          </p>
                        )}
                        {coverage.warranty && (
                          <p className="flex items-center gap-1.5">
                            <ShieldCheck
                              className="size-3.5 shrink-0"
                              style={{ color: coverage.warranty.expired ? undefined : "#10A765" }}
                            />
                            {coverage.warranty.expired ? (
                              <span className="text-muted-foreground">
                                Warranty expired{" "}
                                {coverage.warranty.untilDate.toLocaleDateString("en-US", {
                                  year: "numeric",
                                  month: "short",
                                })}
                              </span>
                            ) : (
                              <span className="font-medium" style={{ color: "#10A765" }}>
                                Under warranty until{" "}
                                {coverage.warranty.untilDate.toLocaleDateString("en-US", {
                                  year: "numeric",
                                  month: "short",
                                })}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <Link
                    href={`/d/${doc.token}`}
                    className="shrink-0 text-xs font-medium text-primary hover:underline"
                  >
                    View →
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
