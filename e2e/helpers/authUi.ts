import { expect, type Locator, type Page } from '@playwright/test';

interface OpenAuthSurfaceOptions {
  keyboard?: boolean;
}

export interface AuthSurface {
  dialog: Locator;
  entryTrigger: Locator;
  presentation: 'dialog' | 'drawer';
}

async function activate(locator: Locator, keyboard: boolean): Promise<void> {
  await expect(locator).toBeVisible();
  if (keyboard) {
    await locator.focus();
    await expect(locator).toBeFocused();
    await locator.press('Enter');
    return;
  }
  await locator.click();
}

export async function openAuthSurface(
  page: Page,
  { keyboard = false }: OpenAuthSurfaceOptions = {},
): Promise<AuthSurface> {
  const desktopTrigger = page.getByRole('button', { name: /^登入$/ }).first();
  if (await desktopTrigger.isVisible()) {
    await activate(desktopTrigger, keyboard);
    const dialog = page.getByRole('dialog', { name: '登入 / 註冊' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tablist', { name: '登入 / 註冊' })).toBeVisible();
    return { dialog, entryTrigger: desktopTrigger, presentation: 'dialog' };
  }

  const menuTrigger = page.getByRole('button', { name: '主選單' });
  await activate(menuTrigger, keyboard);
  const drawer = page.getByRole('dialog', { name: '主選單' });
  await expect(drawer).toBeVisible();

  const authTrigger = drawer.getByRole('button', { name: '登入 / 註冊' });
  await activate(authTrigger, keyboard);
  await expect(drawer.getByRole('tablist', { name: '登入 / 註冊' })).toBeVisible();
  return { dialog: drawer, entryTrigger: menuTrigger, presentation: 'drawer' };
}
