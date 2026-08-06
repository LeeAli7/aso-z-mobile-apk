// Smoke-тест normalizeChatUrl без jest (node --experimental-strip-types)
import { normalizeChatUrl, baseProviderUrl } from "./url.ts";

let failed = 0;
function eq(desc, got, want) {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${desc}  =>  ${JSON.stringify(got)}`);
  if (!ok) {
    console.log(`      want ${JSON.stringify(want)}`);
    failed++;
  }
}

eq("голый хост", normalizeChatUrl("https://api.example.com"),
  "https://api.example.com/chat/completions");
eq("/v1", normalizeChatUrl("https://api.example.com/v1"),
  "https://api.example.com/v1/chat/completions");
eq("trailing slash", normalizeChatUrl("https://api.example.com/v1/"),
  "https://api.example.com/v1/chat/completions");
eq("уже полный", normalizeChatUrl("https://api.example.com/v1/chat/completions"),
  "https://api.example.com/v1/chat/completions");
eq("kilo", normalizeChatUrl("https://api.kilo.ai/api/openrouter"),
  "https://api.kilo.ai/api/openrouter/chat/completions");
eq("opencode", normalizeChatUrl("https://opencode.ai/zen/v1"),
  "https://opencode.ai/zen/v1/chat/completions");
eq("empty", normalizeChatUrl(""), "");

eq("baseProviderUrl", baseProviderUrl("https://api.example.com/v1/chat/completions"),
  "https://api.example.com/v1");
eq("baseProviderUrl голый", baseProviderUrl("https://api.example.com/v1"),
  "https://api.example.com/v1");

console.log(failed ? `\nFAILED ${failed}` : "\nALL PASS");
process.exit(failed ? 1 : 0);