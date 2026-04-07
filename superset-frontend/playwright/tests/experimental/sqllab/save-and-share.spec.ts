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
import { test } from '../../../helpers/fixtures/testAssets';
import { SqlLabPage } from '../../../pages/SqlLabPage';
import { ExplorePage } from '../../../pages/ExplorePage';
import { SaveQueryModal } from '../../../components/modals/SaveQueryModal';
import { SaveDatasetModal } from '../../../components/modals/SaveDatasetModal';
import { waitForGet, waitForPost } from '../../../helpers/api/intercepts';
import {
  expectStatus,
  extractIdFromResponse,
} from '../../../helpers/api/assertions';
import { apiGetSavedQuery } from '../../../helpers/api/savedQuery';
import { TIMEOUT } from '../../../utils/constants';
import { URL } from '../../../utils/urls';

let sqlLabPage: SqlLabPage;

test.beforeEach(async ({ page }) => {
  test.setTimeout(TIMEOUT.SLOW_TEST);
  sqlLabPage = new SqlLabPage(page);
  await sqlLabPage.gotoAndReady();
});

test('saves a query and loads it from saved queries', async ({
  page,
  testAssets,
}) => {
  const queryText = 'SELECT 1 AS saved_test_col';
  const savedQueryTitle = `pw_test_saved_query_${Date.now()}`;

  // Verify left sidebar is interactive
  await expect(sqlLabPage.databaseSelector).toBeVisible();

  // Run query and wait for results
  await sqlLabPage.executeQuery(queryText);
  await sqlLabPage.waitForQueryResults();

  // Open the save query modal
  await sqlLabPage.saveButton.click();
  const saveModal = new SaveQueryModal(page);
  await saveModal.waitForReady();

  // Fill in the query name
  await saveModal.nameInput.clear();
  await saveModal.nameInput.fill(savedQueryTitle);

  // Save and intercept the API response
  const savePromise = waitForPost(page, 'api/v1/saved_query/', {
    timeout: TIMEOUT.API_RESPONSE,
  });
  await saveModal.getFooterButton('Save').click();
  const saveResponse = await savePromise;
  expectStatus(saveResponse, 201);

  // Extract saved query ID for cleanup
  const savedQueryId = await extractIdFromResponse(saveResponse);
  testAssets.trackSavedQuery(savedQueryId);

  // Verify the modal closed
  await saveModal.waitForHidden();

  // Verify the saved query via API (round-trip persistence check)
  const getResponse = await apiGetSavedQuery(page, savedQueryId);
  const savedQuery = (await getResponse.json()).result;
  expect(savedQuery.sql).toContain('saved_test_col');
  expect(savedQuery.label).toBe(savedQueryTitle);

  // End-to-end reopen: navigate to SQL Lab with savedQueryId URL param.
  // This exercises the PopEditorTab → popSavedQuery hydration path that
  // the Saved Queries list and home page link to.
  //
  // Register the API listener BEFORE navigating so we catch the
  // GET /api/v1/saved_query/:id that popSavedQuery fires on mount.
  // Without this, the editor may still contain saved_test_col from the
  // previous step, making the assertion pass without exercising the
  // hydration path.
  const savedQueryHydration = waitForGet(
    page,
    `api/v1/saved_query/${savedQueryId}`,
    { timeout: TIMEOUT.API_RESPONSE },
  );
  await page.goto(`${URL.SQLLAB}?savedQueryId=${savedQueryId}`, {
    waitUntil: 'domcontentloaded',
  });
  await savedQueryHydration;
  await sqlLabPage.waitForPageLoad();
  await sqlLabPage.ensureEditorReady();

  // Verify the saved query's SQL loaded into the editor
  const loadedSql = await sqlLabPage.getQuery();
  expect(loadedSql).toContain('saved_test_col');
});

test('creates a dataset from query results', async ({ page, testAssets }) => {
  // Select database to enable the "Save dataset" toolbar button
  await sqlLabPage.selectDatabase('examples');

  // SELECT 1 doesn't depend on sample data — a non-200 is a real failure
  const executeResponse = await sqlLabPage.executeQuery(
    'SELECT 1 AS ds_test_col',
  );
  expectStatus(executeResponse, 200);
  await sqlLabPage.waitForQueryResults();

  // Click "Save dataset" button in the toolbar
  await sqlLabPage.saveDatasetButton.click();

  // Wait for the Save Dataset modal
  const saveDatasetModal = new SaveDatasetModal(page);
  await saveDatasetModal.waitForReady();

  // Fill in a unique dataset name
  const datasetName = `pw_test_dataset_${Date.now()}`;
  await saveDatasetModal.nameInput.clear();
  await saveDatasetModal.nameInput.fill(datasetName);

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
  await saveDatasetModal.getFooterButton('Save & Explore').click();

  // Capture dataset ID for cleanup
  const createResponse = await datasetCreatePromise;
  const datasetId = await extractIdFromResponse(createResponse);
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
