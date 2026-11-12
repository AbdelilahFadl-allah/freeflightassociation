import { describe, expect, it } from "vitest";
import twilio from "twilio";
import { createTwilioProvider } from "../server/whatsapp";

describe("WhatsApp provider configuration", () => {
  it("disables messaging when no provider is configured and rejects partial configuration", () => {
    expect(createTwilioProvider({})).toBeUndefined();
    expect(() => createTwilioProvider({ TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000" })).toThrow();
  });

  it("verifies the callback against its configured public origin", () => {
    const token = "test-token";
    const provider = createTwilioProvider({
      TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
      TWILIO_AUTH_TOKEN: token,
      TWILIO_WHATSAPP_FROM: "whatsapp:+212612345678",
      TWILIO_CALLBACK_BASE_URL: "https://example.test",
      WHATSAPP_TEMPLATES_JSON: JSON.stringify([{ id: "notice", label: "Notice", contentSid: "HX00000000000000000000000000000000" }]),
    });
    expect(provider).toBeDefined();
    if (!provider) throw new Error("Provider not configured");
    const url = provider.callbackUrl("00000000-0000-4000-8000-000000000001");
    const body = { MessageSid: "SM00000000000000000000000000000000", MessageStatus: "delivered" };
    const signature = twilio.getExpectedTwilioSignature(token, url, body);
    expect(provider.verify(signature, url, body)).toBe(true);
    expect(provider.verify(signature, url, { ...body, MessageStatus: "read" })).toBe(false);
  });
});
