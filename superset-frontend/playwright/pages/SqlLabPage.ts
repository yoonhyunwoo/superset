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

  private static readonly SELECTORS = {
    SQL_EDITOR_TABS: '[data-test="sql-editor-tabs"]',
    TABLIST: '[data-test="sql-editor-tabs"] > [role="tablist"]',
    TAB: '[data-test="sql-editor-tabs"] > [role="tablist"] [role="tab"]:not([type="button"])',
    ADD_TAB_ICON: '[data-test="add-tab-icon"]',
    DROPDOWN_TRIGGER: '[data-test="dropdown-trigger"]',
    CLOSE_TAB_MENU_OPTION: '[data-test="close-tab-menu-option"]',
    RUN_QUERY_BUTTON: '[data-test="run-query-action"]',
    SOUTH_PANE: '[data-test="south-pane"]',
    EXPLORE_RESULTS_BUTTON: '[data-test="explore-results-button"]',
    SAVE_BUTTON: 'button[aria-label="Save"]',
    SAVE_QUERY_MODAL: '.save-query-modal',
    ACE_EDITOR: '.ace_editor',
    LEFT_BAR: '[data-test="sql-editor-left-bar"]',
    DATABASE_SELECTOR: '[data-test="DatabaseSelector"]',
    LIMIT_DROPDOWN: '.limitDropdown',
    TAB_REMOVE: '[aria-label="remove"]',
  } as const;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ──

  async goto(): Promise<void> {
    await this.page.goto(URL.SQLLAB, { waitUntil: 'domcontentloaded' });
  }

  async waitForPageLoad(options?: { timeout?: number }): Promise<void> {
    // SQL Lab with dev server can be slow on first load (webpack HMR + React hydration)
    const timeout = options?.timeout ?? TIMEOUT.QUERY_EXECUTION;
    await this.page
      .locator(SqlLabPage.SELECTORS.SQL_EDITOR_TABS)
      .waitFor({ state: 'visible', timeout });
  }

  /**
   * Ensures at least one query editor tab exists. Creates one if SQL Lab
   * is in the empty state ("Add a new tab to create SQL Query").
   * Waits for the ace editor to be ready before returning.
   */
  async ensureEditorReady(): Promise<void> {
    const editorLocator = this.page.locator(SqlLabPage.SELECTORS.ACE_EDITOR);
    const editorCount = await editorLocator.count();
    if (editorCount === 0) {
      await this.addTab();
      // Wait for new tab panel to render
      await this.page.waitForTimeout(1000);
    }
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

  private get tabs(): Locator {
    return this.page.locator(SqlLabPage.SELECTORS.TAB);
  }

  async getTabCount(): Promise<number> {
    return this.tabs.count();
  }

  async getTabNames(): Promise<string[]> {
    return this.tabs.allTextContents();
  }

  async addTab(): Promise<void> {
    // Target the visible "Add tab" button — there can be duplicates in the DOM
    await this.page
      .locator(SqlLabPage.SELECTORS.SQL_EDITOR_TABS)
      .getByRole('button', { name: 'Add tab' })
      .first()
      .click();
  }

  async addTabByShortcut(): Promise<void> {
    const modifier = process.platform === 'win32' ? 'Control+q' : 'Control+t';
    await this.page.keyboard.press(modifier);
  }

  async closeLastTab(): Promise<void> {
    const countBefore = await this.getTabCount();
    // Click the × (close) button on the last tab.
    await this.page
      .locator(
        `${SqlLabPage.SELECTORS.TABLIST} ${SqlLabPage.SELECTORS.TAB_REMOVE}`,
      )
      .last()
      .click();
    // Wait for tab count to decrease
    const tabSelector = SqlLabPage.SELECTORS.TAB;
    await this.page.waitForFunction(
      ([sel, expected]) => document.querySelectorAll(sel).length === expected,
      [tabSelector, countBefore - 1] as const,
      { timeout: 5000 },
    );
  }

  getTab(name: string): Locator {
    return this.page.locator('[role="tab"]', { hasText: name });
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
