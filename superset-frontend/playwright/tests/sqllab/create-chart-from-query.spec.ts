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
import { ExplorePage } from '../../pages/ExplorePage';
import { waitForPost } from '../../helpers/api/intercepts';
import { TIMEOUT } from '../../utils/constants';

test('should navigate to Explore from SQL Lab query results', async ({
  page,
}) => {
  const sqlLabPage = new SqlLabPage(page);
  await sqlLabPage.goto();
  await sqlLabPage.waitForPageLoad();
  await sqlLabPage.ensureEditorReady();

  // Select database via left sidebar — this triggers the database list API fetch
  // which populates the Redux store with allows_subquery (needed for Create chart button)
  await sqlLabPage.selectDatabase('examples');

  const query = 'SELECT gender, name FROM birth_names';
  await sqlLabPage.setQuery(query);

  const executePromise = waitForPost(page, 'api/v1/sqllab/execute/', {
    timeout: TIMEOUT.QUERY_EXECUTION,
  });
  await sqlLabPage.runQuery();
  const executeResponse = await executePromise;

  // Skip test if birth_names table doesn't exist (sample data not loaded)
  if (executeResponse.status() !== 200) {
    test.skip(true, 'birth_names table not available — sample data not loaded');
  }

  await sqlLabPage.waitForQueryResults();

  // "Create chart" should be enabled when database.allows_subquery is true.
  // If this fails, the database configuration is broken.
  await expect(sqlLabPage.getCreateChartButton()).toBeEnabled({
    timeout: 10000,
  });
  await sqlLabPage.clickCreateChart();

  // Wait for navigation to Explore page
  const explorePage = new ExplorePage(page);
  await explorePage.waitForPageLoad({ timeout: TIMEOUT.PAGE_LOAD });

  // Verify the datasource control shows the query
  const datasetName = await explorePage.getDatasetName();
  expect(datasetName).toContain(query);
});
