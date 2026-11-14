import { expect, test } from "./fixtures.ts";
import { readFile } from "node:fs/promises";

for (const lang of ["zh-CN", "en"] as const) {
  test("explore and export in " + lang, async ({ page }) => {
    const zh = lang === "zh-CN";
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/?lang=" + lang);
    await expect(
      page.getByRole("heading", {
        name: zh ? "西安雾霾统计" : "Haze days in Xi'an",
      }),
    ).toBeVisible();
    await expect(page.locator(".calendar-summary")).toContainText(
      zh ? "年雾霾合计" : "haze days",
    );
    await expect(page.locator(".calendar-summary")).toContainText("> 75");
    await expect(page.locator(".site-footer")).toContainText("MIT License");
    await expect(page.locator(".site-footer")).not.toContainText(
      zh ? "中国环境监测总站" : "CNEMC",
    );
    await page
      .getByRole("navigation")
      .getByRole("link", { name: zh ? "数据说明" : "Data notes" })
      .click();
    await expect(page.locator("main.notes")).toContainText(
      zh ? "中国环境监测总站" : "CNEMC",
    );
    await page
      .getByRole("navigation")
      .getByRole("link", { name: zh ? "统计" : "Explore" })
      .click();
    const search = page.getByRole("combobox", {
      name: zh ? "查找城市" : "Find a city",
    });
    await search.fill("shanghai");
    await expect(
      page.getByRole("option", {
        name: zh ? "上海 上海" : "Shanghai Shanghai",
      }),
    ).toBeVisible();
    await search.press("ArrowDown");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/city\/CN-310100/);
    await expect(
      page.getByRole("heading", {
        name: zh ? "年度雾霾天数" : "Annual haze days",
      }),
    ).toBeVisible();
    await page
      .getByLabel(zh ? "数据源" : "Data source", { exact: true })
      .first()
      .selectOption("cnemc-recent");
    await page
      .getByLabel(zh ? "判定标准" : "Threshold", { exact: true })
      .first()
      .selectOption("us-pm25-35");
    await expect(page.locator(".chart-provenance").first()).toContainText(
      "> 35",
    );
    await page
      .getByRole("button", { name: zh ? "多城市对比" : "City comparison" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: zh ? "多城市对比" : "City comparison",
      }),
    ).toBeVisible();
    const cityColumn = page
      .getByRole("columnheader")
      .filter({
        has: page.getByRole("button", {
          name: zh ? "城市" : "City",
          exact: true,
        }),
      });
    await cityColumn.getByRole("button").click();
    await expect(cityColumn).toHaveAttribute("aria-sort", "ascending");
    await cityColumn.getByRole("button").press("Enter");
    await expect(cityColumn).toHaveAttribute("aria-sort", "descending");
    await page
      .getByRole("button", { name: zh ? "单城市统计" : "Single city" })
      .click();
    await page
      .getByRole("button", { name: zh ? "导出报告" : "Export report" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(zh ? "画布尺寸" : "Canvas size").selectOption("4k");
    await expect(
      dialog.getByRole("img", { name: zh ? "预览" : "Preview" }),
    ).toBeVisible();
    const downloaded = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: zh ? "下载 PNG" : "Download PNG" })
      .click();
    const result = await downloaded;
    expect(result.suggestedFilename()).toMatch(
      /^haze_.+_us-pm25-35-meteo-default_\d{8}\.png$/,
    );
    const file = await readFile((await result.path())!);
    expect(file.subarray(1, 4).toString()).toBe("PNG");
    expect([file.readUInt32BE(16), file.readUInt32BE(20)]).toEqual([
      3840, 2160,
    ]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(
      page.getByLabel(zh ? "数据源" : "Data source", { exact: true }).first(),
    ).toHaveValue("cnemc-recent");
    expect(errors).toEqual([]);
  });
}
