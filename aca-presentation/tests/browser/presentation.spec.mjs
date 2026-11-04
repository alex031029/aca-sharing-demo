import { expect, test } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

test("slides navigate with keyboard and preserve a deep link", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#intro")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#runtime")).toBeVisible();
  await expect(page).toHaveURL(/#runtime$/);
  await page.reload();
  await expect(page.locator("#runtime")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(page.locator("#intro")).toBeVisible();
});

test("the runtime card uses the real API and does not poll", async ({ page }) => {
  let requests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/info") requests++;
  });
  await page.goto("/#runtime");
  await expect(page.getByTestId("runtime-status")).toContainText("尚未请求");
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "发送真实请求", exact: true }).click();
  await expect(page.getByTestId("runtime-status")).toContainText("请求成功");
  await expect(page.getByTestId("version")).toHaveText("v1");
  await expect(page.getByTestId("environment")).toHaveText("Local");
  const firstId = await page.getByTestId("request-id").textContent();
  await page.getByRole("button", { name: "发送真实请求", exact: true }).click();
  await expect(page.getByTestId("request-id")).not.toHaveText(firstId);
  expect(requests).toBe(2);
  await expect(page.locator("#request-history tbody tr")).toHaveCount(2);
});

test("a failed request is shown explicitly without pretending old data is live", async ({ page }) => {
  await page.goto("/#runtime");
  await page.getByRole("button", { name: "发送真实请求", exact: true }).click();
  await expect(page.getByTestId("runtime-status")).toContainText("请求成功");
  await page.route("**/api/info", (route) => route.fulfill({
    status: 503, contentType: "application/json", body: '{"error":"Unavailable"}',
  }));
  await page.getByRole("button", { name: "发送真实请求", exact: true }).click();
  await expect(page.getByTestId("runtime-status")).toContainText("请求失败");
  await expect(page.locator("#request-error")).toContainText("503");
  await expect(page.locator("#snapshot-label")).toContainText("上次成功请求");
  await expect(page.getByTestId("version")).toHaveText("v1");
});

test("a newly deployed version is visible without reloading the deck", async ({ page }) => {
  await page.goto("/#runtime");
  await page.getByRole("button", { name: "发送真实请求", exact: true }).click();
  await expect(page.getByTestId("version")).toHaveText("v1");
  await page.route("**/api/info", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, version: "v2", revision: "sharing--v2" } });
  });
  await page.getByRole("button", { name: "发送真实请求", exact: true }).click();
  await expect(page.locator("#version-change")).toContainText("v1 → v2");
  await expect(page.getByTestId("version")).toHaveText("v2");
  await expect(page).toHaveURL(/#runtime$/);
});

test("the deck remains readable offline and does not invent API results", async ({ page }) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  await page.goto(pathToFileURL(resolve(root, "wwwroot", "index.html")).href);
  await expect(page.locator("#intro")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#runtime")).toBeVisible();
  await expect(page.getByTestId("runtime-status")).toContainText("离线讲义");
  await expect(page.getByRole("button", { name: "发送真实请求", exact: true })).toBeDisabled();
});

test("the runtime card fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#runtime");
  await page.getByRole("button", { name: "发送真实请求", exact: true }).click();
  await expect(page.getByTestId("runtime-status")).toContainText("请求成功");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
