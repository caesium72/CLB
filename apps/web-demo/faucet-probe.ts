import { chromium } from "@playwright/test";

const ADDRESS = "0x8eEd4275420870c43C06f370Af3AD53FFdB3B005";
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto("https://sepolia-faucet.pk910.de/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);

console.log("inputs:", await page.locator("input").count());
console.log(
  "html:",
  (await page.locator("input").evaluateAll((els) => els.map((e) => e.outerHTML.slice(0, 220)))).join("\n"),
);

const field = page.getByPlaceholder("Please enter ETH address or ENS name");
console.log("field count:", await field.count());
await field.fill(ADDRESS, { timeout: 15000 }).catch((e) => console.log("fill error:", e.message));
console.log("value:", await field.inputValue().catch((e) => e.message));

await page.getByRole("button", { name: "Start Mining" }).click({ timeout: 15000 }).catch((e) => console.log("click error:", e.message));
await page.waitForTimeout(20000);
console.log("TEXT:", (await page.locator("body").innerText()).slice(0, 3000));
await browser.close();
