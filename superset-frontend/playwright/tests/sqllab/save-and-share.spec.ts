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

import { expect } from '@playwright/test';
import { test } from '../../helpers/fixtures/testAssets';
import { SqlLabPage } from '../../pages/SqlLabPage';
import { ExplorePage } from '../../pages/ExplorePage';
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

test('saves a query and loads it from saved queries', async ({
  page,
  testAssets,
}) => {
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

test('creates a dataset from query results', async ({ page, testAssets }) => {
  // Select database to enable the "Save dataset" toolbar button
  await sqlLabPage.selectDatabase('examples');

  const queryText = 'SELECT 1 AS ds_test_col';
  await sqlLabPage.setQuery(queryText);

  const executePromise = waitForPost(page, 'api/v1/sqllab/execute/', {
    timeout: TIMEOUT.QUERY_EXECUTION,
  });
  await sqlLabPage.runQuery();
  const executeResponse = await executePromise;

  if (executeResponse.status() !== 200) {
    test.skip(true, 'Query execution failed — database may not be configured');
  }

  await sqlLabPage.waitForQueryResults();

  // Click "Save dataset" button in the toolbar
  await sqlLabPage.clickSaveDatasetButton();

  // Wait for the Save Dataset modal
  const saveDatasetModal = sqlLabPage.getSaveDatasetModal();
  await saveDatasetModal.waitForReady();

  // Fill in a unique dataset name
  const datasetName = `pw_test_dataset_${Date.now()}`;
  const nameInput = saveDatasetModal.body.locator(
    'input[placeholder="Dataset name"]',
  );
  await nameInput.clear();
  await nameInput.fill(datasetName);

  // Set up intercepts before clicking save:
  // 1. Dataset creation API
  // 2. New browser tab (SaveDatasetModal opens Explore via window.open)
  const datasetCreatePromise = waitForPost(page, 'api/v1/dataset/', {
    timeout: TIMEOUT.API_RESPONSE,
  });
  const newPagePromise = page.context().waitForEvent('page', {
    timeout: TIMEOUT.API_RESPONSE,
  });

  // Click "Save & Explore"
  await saveDatasetModal.footer
    .getByRole('button', { name: /Save & Explore/i })
    .click();

  // Capture dataset ID for cleanup
  const createResponse = await datasetCreatePromise;
  const createBody = await createResponse.json();
  const datasetId: number = createBody.result?.id ?? createBody.id;
  expect(datasetId).toBeTruthy();
  testAssets.trackDataset(datasetId);

  // Wait for the new tab with Explore page
  const newPage = await newPagePromise;
  await newPage.waitForLoadState();

  const explorePage = new ExplorePage(newPage);
  await explorePage.waitForPageLoad({ timeout: TIMEOUT.PAGE_LOAD });

  // Verify the dataset name appears in the Explore datasource control
  const loadedDatasetName = await explorePage.getDatasetName();
  expect(loadedDatasetName).toContain(datasetName);

  await newPage.close();
});
