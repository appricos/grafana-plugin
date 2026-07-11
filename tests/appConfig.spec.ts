import { test, expect } from './fixtures';

test('should render the Connect form when not yet connected to Pushinator', async ({ appConfigPage, page }) => {
  await expect(page.getByRole('textbox', { name: /pushinator account token/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^connect$/i })).toBeVisible();
});
