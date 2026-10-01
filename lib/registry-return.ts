/** Pure guard for "return to stock": null = allowed, "noop" = already in
 *  stock, anything else = a user-facing refusal message. */
export function returnToStockBlocker(row: { status: string; deviceId: string | null }): string | null {
  if (row.status === "manufactured") return "noop";
  if (row.status !== "rma" && row.status !== "retired") {
    return "Only RMA or retired serials can be returned to stock.";
  }
  if (row.deviceId) return "Delete the device first, then return the serial to stock.";
  return null;
}
