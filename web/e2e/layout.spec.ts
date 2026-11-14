import { expect, test } from "./fixtures.ts";

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(
    "responsive light and dark at " + viewport.width,
    async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await page.goto("/?lang=zh-CN");
      await expect(
        page.getByRole("heading", { name: "年度雾霾天数" }),
      ).toBeVisible();
      await expect(
        page.locator(".chart").nth(2).locator("canvas").first(),
      ).toBeAttached();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(viewport.width);
      await page.screenshot({
        path: info.outputPath("light-" + viewport.width + ".png"),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "深色主题" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.screenshot({
        path: info.outputPath("dark-" + viewport.width + ".png"),
        animations: "disabled",
      });
    },
  );
}
