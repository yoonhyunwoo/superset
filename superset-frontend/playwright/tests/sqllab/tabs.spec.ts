/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { test, expect } from '@playwright/test';
import { SqlLabPage } from '../../pages/SqlLabPage';
import { waitForPost } from '../../helpers/api/intercepts';

let sqlLabPage: SqlLabPage;

test.beforeEach(async ({ page }) => {
  sqlLabPage = new SqlLabPage(page);
  await sqlLabPage.goto();
  await sqlLabPage.waitForPageLoad();
  await sqlLabPage.ensureEditorReady();
});

test('should create tabs that persist across page reload', async ({
  page,
}) => {
  const initialTabCount = await sqlLabPage.getTabCount();

  // Create a new tab and verify count incremented
  await sqlLabPage.addTab();
  await sqlLabPage.getEditor().waitForReady();
  expect(await sqlLabPage.getTabCount()).toBe(initialTabCount + 1);

  // Set up tab state intercept before making changes (avoid race with debounced save)
  const tabStatePromise = waitForPost(page, 'tabstateview');

  // Type a distinctive query so we can verify persistence
  const testQuery = `SELECT 'persistence_test_${Date.now()}'`;
  await sqlLabPage.setQuery(testQuery);

  // Trigger a save by blurring the editor (tab state saves on editor changes)
  await page.locator('body').click();
  await tabStatePromise;

  // Reload the page
  await page.reload();
  await sqlLabPage.waitForPageLoad();
  await sqlLabPage.ensureEditorReady();

  // Verify the tab survived the reload
  expect(await sqlLabPage.getTabCount()).toBe(initialTabCount + 1);

  // Verify the editor content survived the reload
  const restoredQuery = await sqlLabPage.getQuery();
  expect(restoredQuery).toContain('persistence_test_');

  // Clean up: close the tab we created
  await sqlLabPage.closeLastTab();
  expect(await sqlLabPage.getTabCount()).toBe(initialTabCount);
});

test('should open new tab by keyboard shortcut with correct defaults', async ({
  page,
}) => {
  const initialTabCount = await sqlLabPage.getTabCount();

  // Type something in the current editor to differentiate from default state
  await sqlLabPage.setQuery('some random query string');

  // Open new tab via keyboard shortcut
  await sqlLabPage.addTabByShortcut();
  await sqlLabPage.getEditor().waitForReady();
  expect(await sqlLabPage.getTabCount()).toBe(initialTabCount + 1);

  // Verify new tab has default editor content
  const defaultContent = await sqlLabPage.getQuery();
  expect(defaultContent).toContain('SELECT');

  // Set up tab state intercept before triggering save (avoid race with debounced save)
  const tabStatePromise = waitForPost(page, 'tabstateview');
  await page.locator('body').click();
  await tabStatePromise;

  await page.reload();
  await sqlLabPage.waitForPageLoad();
  await sqlLabPage.ensureEditorReady();

  // Verify the new tab persisted after reload
  expect(await sqlLabPage.getTabCount()).toBe(initialTabCount + 1);

  // Clean up: close the new tab
  await sqlLabPage.closeLastTab();
  expect(await sqlLabPage.getTabCount()).toBe(initialTabCount);
});
