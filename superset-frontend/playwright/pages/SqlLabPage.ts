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

import { Page, Locator, Response } from '@playwright/test';
import { AceEditor } from '../components/core/AceEditor';
import { AgGrid } from '../components/core/AgGrid';
import { EditableTabs } from '../components/core/EditableTabs';
import { Select } from '../components/core/Select';
import { waitForPost } from '../helpers/api/intercepts';
import { URL } from '../utils/urls';
import { TIMEOUT } from '../utils/constants';

/**
 * Page object for SQL Lab.
 *
 * Selectors verified against source code — see plan for line references.
 */
export class SqlLabPage {
  private readonly page: Page;
  private readonly editorTabs: EditableTabs;

  private static readonly SELECTORS = {
    SQL_EDITOR_TABS: '[data-test="sql-editor-tabs"]',
    ADD_TAB_ICON: '[data-test="add-tab-icon"]',
    RUN_QUERY_BUTTON: '[data-test="run-query-action"]',
    SOUTH_PANE: '[data-test="south-pane"]',
    EXPLORE_RESULTS_BUTTON: '[data-test="explore-results-button"]',
    SAVE_BUTTON: 'button[aria-label="Save"]',
    ACE_EDITOR: '.ace_editor',
    LEFT_BAR: '[data-test="sql-editor-left-bar"]',
    DATABASE_SELECTOR: '[data-test="DatabaseSelector"]',
    LIMIT_DROPDOWN: '.limitDropdown',
    SAVE_DATASET_BUTTON: 'button[aria-label="Save dataset"]',
  } as const;

  constructor(page: Page) {
    this.page = page;
    this.editorTabs = new EditableTabs(
      page,
      page.locator(SqlLabPage.SELECTORS.SQL_EDITOR_TABS),
    );
  }

  // ── Navigation ──

  async goto(): Promise<void> {
    await this.page.goto(URL.SQLLAB, { waitUntil: 'domcontentloaded' });
  }

  async waitForPageLoad(options?: { timeout?: number }): Promise<void> {
    // SQL Lab with dev server can be slow on first load (webpack HMR + React hydration)
    const timeout = options?.timeout ?? TIMEOUT.QUERY_EXECUTION;
    await this.editorTabs.element.waitFor({ state: 'visible', timeout });
  }

  /**
   * Navigate to SQL Lab and wait until the editor is ready.
   * Convenience method combining goto + waitForPageLoad + ensureEditorReady.
   */
  async gotoAndReady(): Promise<void> {
    await this.goto();
    await this.waitForPageLoad();
    await this.ensureEditorReady();
  }

  /**
   * Ensures at least one query editor tab exists. Creates one if SQL Lab
   * is in the empty state ("Add a new tab to create SQL Query").
   * Waits for the ace editor to be ready before returning.
   *
   * Uses a two-stage check to handle three states correctly:
   * 1. Empty state (CI): type="card" with 0 queryEditors, no editor → create tab
   * 2. Loading after reload: real tabs exist, editor hasn't mounted yet → just wait
   * 3. Normal: tabs + editor present → ready immediately
   *
   * Stage 1 checks editor presence (catches empty + loading).
   * Stage 2 checks the Ant Design tabs type to distinguish real tabs
   * (type="editable-card") from the empty state (type="card"). The React
   * source (TabbedSqlEditors) sets type based on queryEditors.length,
   * so this directly reflects whether persisted tabs exist.
   */
  async ensureEditorReady(): Promise<void> {
    // Page-global check: are there ANY editors in the DOM (any tab)?
    const anyEditor = this.page.locator(SqlLabPage.SELECTORS.ACE_EDITOR);

    if ((await anyEditor.count()) === 0) {
      // No editor visible. Check if real query editors exist (editable-card)
      // or if this is the empty state (card type, 0 queryEditors).
      // type="editable-card" → queryEditors.length > 0 (even 1 real tab).
      // type="card" → queryEditors.length === 0 (true empty state).
      const isEditableCard = await this.editorTabs.element.evaluate(el =>
        el.classList.contains('ant-tabs-editable-card'),
      );
      if (!isEditableCard) {
        // True empty state — click add-tab icon (works in card mode)
        await this.editorTabs.element
          .locator(SqlLabPage.SELECTORS.ADD_TAB_ICON)
          .first()
          .click();
      }
      // If editable-card: real tabs exist, editor is still mounting — just wait
    }

    // Wait for the editor in the ACTIVE panel, not page-global .first().
    // In persisted multi-tab sessions, .first() can resolve to a hidden
    // inactive editor. activePanel scopes to the visible tab panel.
    await this.activePanel
      .locator(SqlLabPage.SELECTORS.ACE_EDITOR)
      .waitFor({ state: 'visible' });
    await this.editor.waitForReady();
  }

  // ── Active Tab Panel ──

  /**
   * Gets the active tab panel. Ant Design keeps inactive tab panels mounted
   * but sets aria-hidden="true" on them. Using :not([aria-hidden="true"])
   * is more reliable than :visible during tab-switch animations where both
   * panels may briefly have non-zero dimensions.
   */
  private get activePanel(): Locator {
    return this.page
      .locator('[role="tabpanel"]:not([aria-hidden="true"])')
      .filter({ has: this.page.locator(SqlLabPage.SELECTORS.ACE_EDITOR) });
  }

  // ── Elements ──

  get editor(): AceEditor {
    return new AceEditor(
      this.page,
      this.activePanel.locator(SqlLabPage.SELECTORS.ACE_EDITOR),
    );
  }

  get resultsGrid(): AgGrid {
    return new AgGrid(
      this.page,
      this.activePanel
        .locator(SqlLabPage.SELECTORS.SOUTH_PANE)
        .locator('[role="grid"]'),
    );
  }

  get resultsPane(): Locator {
    return this.activePanel.locator(SqlLabPage.SELECTORS.SOUTH_PANE);
  }

  get errorAlert(): Locator {
    return this.resultsPane.locator('.ant-alert-error');
  }

  get databaseSelector(): Locator {
    return this.page.locator(
      `${SqlLabPage.SELECTORS.LEFT_BAR} ${SqlLabPage.SELECTORS.DATABASE_SELECTOR}`,
    );
  }

  get runQueryButton(): Locator {
    return this.activePanel.locator(SqlLabPage.SELECTORS.RUN_QUERY_BUTTON);
  }

  get saveButton(): Locator {
    return this.activePanel.locator(SqlLabPage.SELECTORS.SAVE_BUTTON);
  }

  get saveDatasetButton(): Locator {
    return this.activePanel.locator(SqlLabPage.SELECTORS.SAVE_DATASET_BUTTON);
  }

  get createChartButton(): Locator {
    return this.activePanel.locator(
      SqlLabPage.SELECTORS.EXPLORE_RESULTS_BUTTON,
    );
  }

  // ── Editor Convenience ──

  async setQuery(sql: string): Promise<void> {
    await this.editor.setText(sql);
  }

  async getQuery(): Promise<string> {
    return this.editor.getText();
  }

  // ── Tab Management ──

  async getTabCount(): Promise<number> {
    return this.editorTabs.getTabCount();
  }

  async getTabNames(): Promise<string[]> {
    return this.editorTabs.getTabNames();
  }

  async getActiveTabName(): Promise<string> {
    return this.editorTabs.getActiveTabName();
  }

  async addTab(): Promise<void> {
    await this.editorTabs.addTab();
  }

  async addTabByShortcut(): Promise<void> {
    const modifier = process.platform === 'win32' ? 'Control+q' : 'Control+t';
    await this.page.keyboard.press(modifier);
  }

  async closeLastTab(): Promise<void> {
    const countBefore = await this.getTabCount();
    await this.editorTabs.removeLastTab();
    // Wait for tab count to decrease
    await this.page.waitForFunction(
      ([selector, expected]) => {
        const container = document.querySelector(selector);
        if (!container) return false;
        const nav = container.querySelector(':scope > .ant-tabs-nav');
        if (!nav) return false;
        return nav.querySelectorAll('.ant-tabs-tab').length === expected;
      },
      [SqlLabPage.SELECTORS.SQL_EDITOR_TABS, countBefore - 1] as const,
      { timeout: TIMEOUT.UI_TRANSITION },
    );
  }

  getTab(name: string): Locator {
    return this.editorTabs.getTab(name);
  }

  // ── Database Selection (Left Sidebar) ──

  async selectDatabase(dbName: string): Promise<void> {
    // Click the DatabaseSelector in sqlLabMode to open the popover
    await this.databaseSelector.click();

    // Wait for the popover to appear
    const popover = this.page.locator('.ant-popover-content');
    await popover.waitFor({ state: 'visible' });

    // Inside the popover, select the database from the dropdown.
    // Target the .ant-select wrapper (not the combobox input) because the
    // selection-item overlay intercepts pointer events on the input.
    const dbSelect = popover
      .locator(SqlLabPage.SELECTORS.DATABASE_SELECTOR)
      .locator('.ant-select')
      .first();
    const popoverSelector = new Select(this.page, dbSelect);
    await popoverSelector.selectOption(dbName);

    // Click the "Select" button to confirm
    await popover.getByRole('button', { name: 'Select', exact: true }).click();

    // Wait for popover to close
    await popover
      .waitFor({ state: 'hidden', timeout: TIMEOUT.UI_TRANSITION })
      .catch(() => {});
  }

  // ── Query Execution ──

  /**
   * Sets SQL, runs the query, and waits for the API response.
   * Returns the raw Response so callers can assert status, skip, or ignore.
   * Does NOT assert status or wait for results — use the return value.
   */
  async executeQuery(sql: string): Promise<Response> {
    await this.setQuery(sql);
    const responsePromise = waitForPost(this.page, 'api/v1/sqllab/execute/', {
      timeout: TIMEOUT.QUERY_EXECUTION,
    });
    await this.runQueryButton.click();
    return responsePromise;
  }

  async waitForQueryResults(options?: {
    timeout?: number;
    expectHeader?: string;
  }): Promise<void> {
    const timeout = options?.timeout ?? TIMEOUT.QUERY_EXECUTION;
    const grid = this.resultsGrid.element;
    await grid.waitFor({ state: 'visible', timeout });
    if (options?.expectHeader) {
      // When re-running a query, the previous grid is already visible.
      // Wait for the expected header to appear, confirming fresh results rendered.
      await grid
        .locator('.ag-header-cell', { hasText: options.expectHeader })
        .first()
        .waitFor({ state: 'visible', timeout });
    }
  }

  // ── Row Limit ──

  async getRowLimit(): Promise<string> {
    const text = await this.activePanel
      .locator(SqlLabPage.SELECTORS.LIMIT_DROPDOWN)
      .textContent();
    return text?.trim() ?? '';
  }
}
