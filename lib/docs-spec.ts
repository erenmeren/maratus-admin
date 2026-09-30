// The published spec uses placeholder IDs in every example. For a signed-in
// docs visitor we swap in their own first device/store, so "Test Request"
// targets something that exists instead of 404ing on the placeholder. Pure.
import openapi from "@/openapi.json";

export const EXAMPLE_DEVICE_ID = "dev_V1StGXR8_Z5jdHi6B-myT";
export const EXAMPLE_STORE_ID = "str_9fKq2LmXa0PzR4tYb7NcE";

export function personalizeSpec(ids: { deviceId?: string; storeId?: string }): unknown {
  let text = JSON.stringify(openapi);
  if (ids.deviceId) text = text.replaceAll(EXAMPLE_DEVICE_ID, ids.deviceId);
  if (ids.storeId) text = text.replaceAll(EXAMPLE_STORE_ID, ids.storeId);
  return JSON.parse(text);
}
