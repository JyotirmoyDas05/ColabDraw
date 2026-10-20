import { canEmbed } from "../data/embedPolicy";

describe("canEmbed", () => {
  it("allows ordinary https sites", () => {
    expect(canEmbed("https://21st.dev/@jahed/components/ai-chat-input")).toBe(
      true,
    );
    expect(canEmbed("https://sub.example.org/page?x=1")).toBe(true);
  });

  it("blocks plain http, internal addresses and malformed urls", () => {
    expect(canEmbed("http://example.com")).toBe(false);
    expect(canEmbed("https://localhost:3000")).toBe(false);
    expect(canEmbed("https://192.168.0.1")).toBe(false);
    expect(canEmbed("https://[::1]")).toBe(false);
    expect(canEmbed("https://printer.local")).toBe(false);
    expect(canEmbed("ftp://example.com")).toBe(false);
    expect(canEmbed("not a url")).toBe(false);
  });

  it("blocks listed adult sites and their subdomains", () => {
    expect(canEmbed("https://www.pornhub.com/view")).toBe(false);
    expect(canEmbed("https://anything.xxx")).toBe(false);
    expect(canEmbed("https://notpornhub.com")).toBe(true);
  });
});
