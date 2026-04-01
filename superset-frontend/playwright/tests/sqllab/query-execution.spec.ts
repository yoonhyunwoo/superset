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

import { test, expect } from '../../helpers/fixtures/testAssets';
import { SqlLabPage } from '../../pages/SqlLabPage';
import { waitForPost } from '../../helpers/api/intercepts';
import { apiGetSavedQuery } from '../../helpers/api/savedQuery';
import { TIMEOUT } from '../../utils/constants';

let sqlLabPage: SqlLabPage;

test.beforeEach(async ({ page }) => {
  sqlLabPage = new SqlLabPage(page);
  await sqlLabPage.goto();
  await sqlLabPage.waitForPageLoad();
  await sqlLabPage.ensureEditorReady();
});

test('should execute a query and display results', async ({ page }) => {
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

test('should save and reload a query', async ({ page, testAssets }) => {
  const queryText = 'SELECT 1 AS saved_test_col';
  const savedQueryTitle = `pw_test_saved_query_${Date.now()}`;

  // Verify left sidebar is interactive
  await expect(sqlLabPage.getDatabaseSelectorText()).toBeVisible();

  // Set and run query
  await sqlLabPage.setQuery(queryText);

  const executePromise = waitForPost(page, 'api/v1/sqllab/execute/', {
    timeout: TIMEOUT.QUERY_EXECUTION,
  });
  await sqlLabPage.runQuery();
  await executePromise;
  await sqlLabPage.waitForQueryResults();

  // Open the save query modal
  await sqlLabPage.clickSaveButton();
  const saveModal = sqlLabPage.getSaveQueryModal();
  await saveModal.waitForReady();

  // Fill in the query name
  await saveModal.body.locator('input[type="text"]').first().clear();
  await saveModal.body
    .locator('input[type="text"]')
    .first()
    .fill(savedQueryTitle);

  // Save and intercept the API response
  const savePromise = waitForPost(page, 'api/v1/saved_query/', {
    timeout: TIMEOUT.API_RESPONSE,
  });
  await saveModal.footer
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  const saveResponse = await savePromise;
  expect(saveResponse.status()).toBe(201);

  // Extract saved query ID for cleanup
  const saveBody = await saveResponse.json();
  const savedQueryId: number = saveBody.id ?? saveBody.result?.id;
  expect(savedQueryId).toBeTruthy();
  testAssets.trackSavedQuery(savedQueryId);

  // Verify the modal closed
  await saveModal.waitForHidden();

  // Verify the saved query via API (round-trip persistence check)
  const getResponse = await apiGetSavedQuery(page, savedQueryId);
  const savedQuery = (await getResponse.json()).result;
  expect(savedQuery.sql).toContain('saved_test_col');
  expect(savedQuery.label).toBe(savedQueryTitle);
});
