import { expect, test } from "@playwright/test";

test("public landing page renders the journey entry point", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /your seat\. your journey\./i })).toBeVisible();
  await expect(page.getByRole("link", { name: /explore the journey/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /driver onboarding/i }).first()).toBeVisible();
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


test("driver onboarding explains that access requires administrator approval", async ({ page }) => {
  await page.goto("/operator/onboarding");
  await expect(page.getByRole("heading", { name: /operator onboarding/i })).toBeVisible();
  await expect(page.getByText(/does not grant permission to manage journeys/i)).toBeVisible();
  await expect(page.getByText(/managed manually by the platform administrator/i)).toBeVisible();
});
