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

import { Page, Locator } from '@playwright/test';
import { AceEditor } from '../components/core/AceEditor';
import { AgGrid } from '../components/core/AgGrid';
import { EditableTabs } from '../components/core/EditableTabs';
import { Select } from '../components/core/Select';
import { Modal } from '../components/core/Modal';
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
    SAVE_QUERY_MODAL: '.save-query-modal',
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
   * Ensures at least one query editor tab exists. Creates one if SQL Lab
   * is in the empty state ("Add a new tab to create SQL Query").
   * Waits for the ace editor to be ready before returning.
   *
   * Uses a two-stage check to handle three states correctly:
   * 1. Empty state (CI): type="card" with 1 placeholder tab, no editor → create tab
   * 2. Loading after reload: real tabs exist, editor hasn't mounted yet → just wait
   * 3. Normal: tabs + editor present → ready immediately
   *
   * Stage 1 checks editor presence (catches empty + placeholder).
   * Stage 2 checks tab count to distinguish reload-loading (tabs > 1) from
   * true empty state (0-1 placeholder tabs) when no editor exists.
   */
  async ensureEditorReady(): Promise<void> {
    const editorLocator = this.page.locator(SqlLabPage.SELECTORS.ACE_EDITOR);

    if ((await editorLocator.count()) === 0) {
      // No editor visible. Check if real tabs exist (loading after reload)
      // or if this is the empty state (0 tabs or 1 placeholder "Add a new tab").
      const tabCount = await this.getTabCount();
      if (tabCount <= 1) {
        // Empty state or placeholder — click add-tab icon (works in both card modes)
        await this.editorTabs.element
          .locator(SqlLabPage.SELECTORS.ADD_TAB_ICON)
          .first()
          .click();
      }
      // If tabCount > 1: real tabs exist, editor is loading after reload — just wait
    }

    await editorLocator.first().waitFor({ state: 'visible' });
    await this.getEditor().waitForReady();
  }

  // ── Active Tab Panel ──

  /**
   * Gets the active (visible) tab panel. SQL Lab can have multiple tab panels
   * in the DOM; only the active one is visible. Scoping to this avoids
   * strict mode violations from duplicate elements in inactive panels.
   */
  private get activePanel(): Locator {
    return this.page
      .locator('[role="tabpanel"]')
      .filter({ has: this.page.locator(SqlLabPage.SELECTORS.ACE_EDITOR) })
      .first();
  }

  // ── Editor ──

  getEditor(): AceEditor {
    return new AceEditor(
      this.page,
      this.activePanel.locator(SqlLabPage.SELECTORS.ACE_EDITOR),
    );
  }

  async setQuery(sql: string): Promise<void> {
    await this.getEditor().setText(sql);
  }

  async getQuery(): Promise<string> {
    return this.getEditor().getText();
  }

  // ── Tab Management ──

  async getTabCount(): Promise<number> {
    return this.editorTabs.getTabCount();
  }

  async getTabNames(): Promise<string[]> {
    return this.editorTabs.getTabNames();
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
      { timeout: 5000 },
    );
  }

  getTab(name: string): Locator {
    return this.editorTabs.getTab(name);
  }

  // ── Database Selection (Left Sidebar) ──

  async selectDatabase(dbName: string): Promise<void> {
    // Click the DatabaseSelector in sqlLabMode to open the popover
    await this.page
      .locator(
        `${SqlLabPage.SELECTORS.LEFT_BAR} ${SqlLabPage.SELECTORS.DATABASE_SELECTOR}`,
      )
      .click();

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
    await popover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  getDatabaseSelectorText(): Locator {
    return this.page.locator(
      `${SqlLabPage.SELECTORS.LEFT_BAR} ${SqlLabPage.SELECTORS.DATABASE_SELECTOR}`,
    );
  }

  // ── Query Execution ──

  async runQuery(): Promise<void> {
    await this.activePanel
      .locator(SqlLabPage.SELECTORS.RUN_QUERY_BUTTON)
      .click();
  }

  async waitForQueryResults(options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? TIMEOUT.QUERY_EXECUTION;
    await this.getResultsGrid().element.waitFor({
      state: 'visible',
      timeout,
    });
  }

  /**
   * Returns the AG Grid component in the results pane.
   * Use this to inspect headers, rows, and cell values.
   */
  getResultsGrid(): AgGrid {
    return new AgGrid(
      this.page,
      this.page
        .locator(SqlLabPage.SELECTORS.SOUTH_PANE)
        .locator('[role="grid"]'),
    );
  }

  getResultsPane(): Locator {
    return this.page.locator(SqlLabPage.SELECTORS.SOUTH_PANE);
  }

  getErrorAlert(): Locator {
    return this.getResultsPane().locator('.ant-alert-error');
  }

  // ── Row Limit ──

  async getRowLimit(): Promise<string> {
    // Scope to active tab panel to avoid strict mode violation
    // when multiple tabs have limitDropdown elements
    const text = await this.page
      .locator('[role="tabpanel"]')
      .filter({ has: this.page.locator(SqlLabPage.SELECTORS.ACE_EDITOR) })
      .locator(SqlLabPage.SELECTORS.LIMIT_DROPDOWN)
      .first()
      .textContent();
    return text?.trim() ?? '';
  }

  // ── Save Query ──

  async clickSaveButton(): Promise<void> {
    await this.activePanel.locator(SqlLabPage.SELECTORS.SAVE_BUTTON).click();
  }

  getSaveQueryModal(): Modal {
    return new Modal(this.page, SqlLabPage.SELECTORS.SAVE_QUERY_MODAL);
  }

  // ── Save Dataset ──

  async clickSaveDatasetButton(): Promise<void> {
    await this.activePanel
      .locator(SqlLabPage.SELECTORS.SAVE_DATASET_BUTTON)
      .click();
  }

  getSaveDatasetModal(): Modal {
    return new Modal(
      this.page,
      '[data-test="Save or Overwrite Dataset-modal"] .ant-modal',
    );
  }

  // ── Create Chart ──

  getCreateChartButton(): Locator {
    return this.activePanel.locator(
      SqlLabPage.SELECTORS.EXPLORE_RESULTS_BUTTON,
    );
  }

  async clickCreateChart(): Promise<void> {
    await this.getCreateChartButton().click();
  }
}
