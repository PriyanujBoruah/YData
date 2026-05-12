// js/modules/spreadsheet.js
import { runQuery } from '../core/database.js';

let gridApi = null;
let currentTable = null;
const view = document.getElementById('spreadsheet-view');
const searchInput = document.getElementById('spreadsheet-search');
const btnDelete = document.getElementById('btn-delete-rows');

/**
 * CUSTOM HEADER COMPONENT
 * Provides the UI for Renaming and Deleting columns directly from the header.
 */
class CustomHeader {
    init(params) {
        this.params = params;
        this.eGui = document.createElement('div');
        this.eGui.className = 'custom-header-wrapper';

        // 1. Column Label
        const label = document.createElement('span');
        label.className = 'header-label';
        label.innerText = params.displayName;
        label.title = params.displayName;

        // 2. Action Container (Hidden by default, shown on hover via CSS)
        const actions = document.createElement('div');
        actions.className = 'header-actions';

        // Do not show actions for the checkbox selection column
        if (params.column.getColId() !== 'selection-col') {
            
            // --- RENAME BUTTON ---
            const btnRename = document.createElement('button');
            btnRename.className = 'header-btn';
            btnRename.title = "Rename Column";
            btnRename.innerHTML = `<i data-lucide="edit-2" style="width:12px; height:12px;"></i>`;
            btnRename.onclick = (e) => {
                e.stopPropagation(); // Prevent sorting trigger
                this.onRename();
            };

            // --- DELETE BUTTON ---
            const btnDeleteCol = document.createElement('button');
            btnDeleteCol.className = 'header-btn delete';
            btnDeleteCol.title = "Delete Column";
            btnDeleteCol.innerHTML = `<i data-lucide="trash-2" style="width:12px; height:12px;"></i>`;
            btnDeleteCol.onclick = (e) => {
                e.stopPropagation(); // Prevent sorting trigger
                this.onDelete();
            };

            actions.appendChild(btnRename);
            actions.appendChild(btnDeleteCol);
        }

        this.eGui.appendChild(label);
        this.eGui.appendChild(actions);

        // Render icons specifically for this small element
        if (window.lucide) {
            lucide.createIcons({ 
                props: { "stroke-width": 3 }, 
                nameAttr: 'data-lucide', 
                root: this.eGui 
            });
        }
    }

    getGui() { return this.eGui; }

    async onRename() {
        const oldName = this.params.column.getColId();
        const newName = prompt(`Enter new name for column "${oldName}":`, oldName);
        
        if (newName && newName !== oldName) {
            // Standardize name (lowercase, underscores)
            const cleanNewName = newName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
            try {
                // DuckDB Syntax
                await runQuery(`ALTER TABLE "${currentTable}" RENAME COLUMN "${oldName}" TO "${cleanNewName}"`);
                console.log(`Schema Updated: ${oldName} -> ${cleanNewName}`);
                
                // Full refresh to update all column internal IDs
                openSpreadsheet(currentTable);
            } catch (e) {
                alert("Rename failed: " + e.message);
            }
        }
    }

    async onDelete() {
        const colName = this.params.column.getColId();
        if (confirm(`Permanently delete the entire "${colName}" column? This cannot be undone.`)) {
            try {
                // DuckDB Syntax
                await runQuery(`ALTER TABLE "${currentTable}" DROP COLUMN "${colName}"`);
                console.log(`Column Dropped: ${colName}`);
                
                openSpreadsheet(currentTable);
            } catch (e) {
                alert("Delete failed: " + e.message);
            }
        }
    }
}

/**
 * OPEN SPREADSHEET
 * Fetches data and initializes AG Grid with the custom header component.
 */
export async function openSpreadsheet(tableName) {
    if (!tableName) return alert("Please upload a dataset first.");
    currentTable = tableName;

    view.classList.remove('view-hidden');
    searchInput.value = '';
    btnDelete.classList.add('hidden');

    // 1. Fetch Data
    const data = await runQuery(`SELECT *, rowid FROM "${tableName}"`);
    
    // 2. Define Columns
    const dbColumns = Object.keys(data[0] || {}).filter(c => c !== 'rowid');
    const columnDefs = [
        {
            colId: 'selection-col',
            headerName: '',
            checkboxSelection: true,
            headerCheckboxSelection: true,
            width: 50,
            pinned: 'left',
            suppressMenu: true,
            sortable: false,
            filter: false,
            resizable: false,
            headerComponent: CustomHeader // Enables delete on selection col (optional)
        },
        ...dbColumns.map(col => ({
            field: col,
            colId: col, // Unique identifier
            headerName: col.charAt(0).toUpperCase() + col.slice(1),
            editable: true,
            sortable: true,
            filter: true,
            resizable: true,
            headerComponent: CustomHeader // 🚀 Uses the Rename/Delete UI
        }))
    ];

    // 3. Grid Configuration
    const gridOptions = {
        theme: agGrid.themeMaterial.withParams({
            accentColor: "#6002ee",
            primaryColor: "#6002ee",
            fontSize: 14,
            wrapperBorder: false,
            headerBackgroundColor: "#ffffff",
            rowSelectedColor: "#f3e8ff"
        }),
        columnDefs: columnDefs,
        rowData: data,
        pagination: true,
        paginationPageSize: 100,
        paginationPageSizeSelector: [10, 50, 100, 500],
        rowSelection: 'multiple',
        suppressRowClickSelection: true,
        animateRows: true,
        defaultColDef: {
            flex: 1,
            minWidth: 150,
            filter: true,
        },
        // Handles Bulk Row Deletion UI
        onSelectionChanged: () => {
            const selectedNodes = gridApi.getSelectedNodes();
            if (selectedNodes.length > 0) {
                btnDelete.classList.remove('hidden');
                btnDelete.innerHTML = `<i data-lucide="trash-2" class="w-4 h-4"></i> <span>Delete (${selectedNodes.length})</span>`;
                lucide.createIcons();
            } else {
                btnDelete.classList.add('hidden');
            }
        },
        // Handles Inline Cell Edits
        onCellValueChanged: async (params) => {
            const col = params.colDef.field;
            const newVal = params.newValue;
            const rid = params.data.rowid;

            // Escaping single quotes for SQL safety
            const safeVal = String(newVal).replace(/'/g, "''");
            const sql = `UPDATE "${tableName}" SET "${col}" = '${safeVal}' WHERE rowid = ${rid}`;
            await runQuery(sql);
            console.log("Vault Updated:", col, "->", newVal);
        }
    };

    // 4. Render Grid
    const gridDiv = document.getElementById('spreadsheet-grid-container');
    gridDiv.innerHTML = ''; 
    gridApi = agGrid.createGrid(gridDiv, gridOptions);
    lucide.createIcons();
}

export function closeSpreadsheet() {
    view.classList.add('view-hidden');
}

// Global UI Listeners
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        if (gridApi) gridApi.setGridOption('quickFilterText', e.target.value);
    });
}

if (btnDelete) {
    btnDelete.addEventListener('click', async () => {
        const selectedData = gridApi.getSelectedRows();
        if (selectedData.length === 0) return;
        if (!confirm(`Delete ${selectedData.length} rows permanently?`)) return;

        try {
            const rowIds = selectedData.map(r => r.rowid).join(',');
            await runQuery(`DELETE FROM "${currentTable}" WHERE rowid IN (${rowIds})`);
            gridApi.applyTransaction({ remove: selectedData });
            btnDelete.classList.add('hidden');
        } catch (e) {
            alert("Delete failed: " + e.message);
        }
    });
}
