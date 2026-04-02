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

test('creates a new tab via button', async () => {
  const initialTabCount = await sqlLabPage.getTabCount();

  await sqlLabPage.addTab();
  await sqlLabPage.getEditor().waitForReady();

  expect(await sqlLabPage.getTabCount()).toBe(initialTabCount + 1);

  // Verify new tab has default SQL content
  const defaultContent = await sqlLabPage.getQuery();
  expect(defaultContent).toContain('SELECT');

  // Clean up
  await sqlLabPage.closeLastTab();
  expect(await sqlLabPage.getTabCount()).toBe(initialTabCount);
});

test('closes a tab via close button', async () => {
  const initialTabCount = await sqlLabPage.getTabCount();

  // Create a tab so we have something to close
  await sqlLabPage.addTab();
  await sqlLabPage.getEditor().waitForReady();
  expect(await sqlLabPage.getTabCount()).toBe(initialTabCount + 1);

  // Close the tab via the × button
  await sqlLabPage.closeLastTab();
  expect(await sqlLabPage.getTabCount()).toBe(initialTabCount);
});

test('preserves query state when switching tabs', async () => {
  const tabOneSql = `SELECT 'tab_one_${Date.now()}'`;
  const tabTwoSql = `SELECT 'tab_two_${Date.now()}'`;

  // Get the first tab's name for switching back later
  const tabNames = await sqlLabPage.getTabNames();
  const firstTabName = tabNames[tabNames.length - 1];

  // Set query in the first (current) tab
  await sqlLabPage.setQuery(tabOneSql);

  // Create second tab and set a different query
  await sqlLabPage.addTab();
  await sqlLabPage.getEditor().waitForReady();
  await sqlLabPage.setQuery(tabTwoSql);

  // Switch back to first tab and verify its content is preserved
  await sqlLabPage.getTab(firstTabName).click();
  await sqlLabPage.getEditor().waitForReady();
  const firstContent = await sqlLabPage.getQuery();
  expect(firstContent).toContain('tab_one_');

  // Switch to second tab and verify its content is preserved
  const updatedNames = await sqlLabPage.getTabNames();
  const secondTabName = updatedNames[updatedNames.length - 1];
  await sqlLabPage.getTab(secondTabName).click();
  await sqlLabPage.getEditor().waitForReady();
  const secondContent = await sqlLabPage.getQuery();
  expect(secondContent).toContain('tab_two_');

  // Clean up
  await sqlLabPage.closeLastTab();
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
