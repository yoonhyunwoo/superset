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
import { TIMEOUT } from '../../utils/constants';

let sqlLabPage: SqlLabPage;

test.beforeEach(async ({ page }) => {
  sqlLabPage = new SqlLabPage(page);
  await sqlLabPage.goto();
  await sqlLabPage.waitForPageLoad();
  await sqlLabPage.ensureEditorReady();
});

test('executes a simple SELECT query and displays results', async ({
  page,
}) => {
  // Verify the left sidebar database selector is visible and interactive (#38833)
  await expect(sqlLabPage.getDatabaseSelectorText()).toBeVisible();

  // Set the query
  await sqlLabPage.setQuery('SELECT 1 AS test_col');

  // Run query and wait for API response
  const executePromise = waitForPost(page, 'api/v1/sqllab/execute/', {
    timeout: TIMEOUT.QUERY_EXECUTION,
  });
  await sqlLabPage.runQuery();
  const response = await executePromise;
  expect(response.status()).toBe(200);

  // Verify results appear in the AG Grid
  await sqlLabPage.waitForQueryResults();
  const grid = sqlLabPage.getResultsGrid();
  const headers = await grid.getHeaderTexts();
  expect(headers.some(h => h.includes('test_col'))).toBe(true);
});

test('shows error message for invalid SQL', async ({ page }) => {
  await sqlLabPage.setQuery(
    'SELECT * FROM a_table_that_does_not_exist_xyz_pw',
  );

  const executePromise = waitForPost(page, 'api/v1/sqllab/execute/', {
    timeout: TIMEOUT.QUERY_EXECUTION,
  });
  await sqlLabPage.runQuery();
  await executePromise;

  // Wait for error alert to render in south pane
  const errorAlert = sqlLabPage.getErrorAlert();
  await expect(errorAlert).toBeVisible({ timeout: TIMEOUT.QUERY_EXECUTION });

  // Verify the south pane contains an error indicator (engine-agnostic)
  const southPane = sqlLabPage.getResultsPane();
  await expect(southPane).toContainText(/error/i);
});

test('re-runs a query and refreshes results', async ({ page }) => {
  // First query
  await sqlLabPage.setQuery('SELECT 1 AS first_col');
  const firstExecute = waitForPost(page, 'api/v1/sqllab/execute/', {
    timeout: TIMEOUT.QUERY_EXECUTION,
  });
  await sqlLabPage.runQuery();
  const firstResponse = await firstExecute;
  expect(firstResponse.status()).toBe(200);
  await sqlLabPage.waitForQueryResults();

  const firstHeaders = await sqlLabPage.getResultsGrid().getHeaderTexts();
  expect(firstHeaders.some(h => h.includes('first_col'))).toBe(true);

  // Second query (re-run with different SQL)
  await sqlLabPage.setQuery('SELECT 2 AS second_col');
  const secondExecute = waitForPost(page, 'api/v1/sqllab/execute/', {
    timeout: TIMEOUT.QUERY_EXECUTION,
  });
  await sqlLabPage.runQuery();
  const secondResponse = await secondExecute;
  expect(secondResponse.status()).toBe(200);
  await sqlLabPage.waitForQueryResults();

  const secondHeaders = await sqlLabPage.getResultsGrid().getHeaderTexts();
  expect(secondHeaders.some(h => h.includes('second_col'))).toBe(true);
  expect(secondHeaders.some(h => h.includes('first_col'))).toBe(false);
});
