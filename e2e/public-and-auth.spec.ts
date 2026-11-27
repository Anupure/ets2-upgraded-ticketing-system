import { expect, test } from "@playwright/test";

test("public landing page renders the journey entry point", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /your seat/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /explore the journey/i })).toBeVisible();
});

test("operator control room redirects anonymous visitors to sign-in", async ({ page }) => {
  await page.goto("/operator");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: /join the convoy/i })).toBeVisible();
});

test("operator ticket actions reject anonymous API requests", async ({ request }) => {
  const response = await request.post(
    "/api/operator/tickets/11111111-1111-4111-8111-111111111111/no-show",
    { data: {} },
  );
  expect(response.status()).toBe(401);
});
