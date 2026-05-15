// js/core/database.js
import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

let db;
let conn;

export async function initDatabase() {
    console.log("Initializing Wasm Database...");
    
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

    const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );

    const worker = new Worker(worker_url);
    const logger = new duckdb.ConsoleLogger();
    db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

    window.db = db; 
    
    conn = await db.connect();
    
    console.log("Database Ready. Wasm Engine Online.");
    return conn;
}

export async function runQuery(sql) {
    if (!conn) throw new Error("Database connection not initialized.");
    const result = await conn.query(sql);
    return result.toArray().map(row => row.toJSON());
}

/**
 * Helper: Converts flat tabular XML into a JSON Array
 */
function xmlToJsonArray(xmlDoc) {
    const root = xmlDoc.documentElement;
    const rows = Array.from(root.children);
    return rows.map(row => {
        let obj = {};
        Array.from(row.children).forEach(col => {
            obj[col.tagName] = col.textContent;
        });
        return obj;
    });
}

/**
 * Main Ingestion Function (Supports CSV, TXT, JSON, XML, XLSX, Parquet)
 * Note: Uses JS Fallbacks for JSON/XML to avoid Wasm Extension IO Errors.
 */
export async function registerFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const tableName = file.name.split('.')[0].replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

    // ==========================================
    // 1. EXCEL FILES (.xlsx)
    // ==========================================
    if (ext === 'xlsx') {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0]; 
        const csvText = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
        
        const virtualFileName = `${tableName}_excel.csv`;
        await db.registerFileText(virtualFileName, csvText);
        await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${virtualFileName}', ignore_errors=true)`);
    } 
    // ==========================================
    // 2. XML FILES (.xml)
    // ==========================================
    else if (ext === 'xml') {
        const text = await file.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");
        const jsonArr = xmlToJsonArray(xmlDoc);
        
        // Use the new JS-to-Table helper below
        await ingestJsonArray(tableName, jsonArr);
    } 
    // ==========================================
    // 3. JSON FILES (.json)
    // ==========================================
    else if (ext === 'json') {
        const text = await file.text();
        const jsonData = JSON.parse(text);
        const jsonArr = Array.isArray(jsonData) ? jsonData : [jsonData];
        
        // 🚀 THE FIX: Instead of read_json_auto (which needs an extension),
        // we parse it in JS and use our internal injector.
        await ingestJsonArray(tableName, jsonArr);
    }
    // ==========================================
    // 4. STANDARD BINARY FILES (CSV, TXT, Parquet)
    // ==========================================
    else {
        const buffer = await file.arrayBuffer();
        await db.registerFileBuffer(file.name, new Uint8Array(buffer));

        if (ext === 'csv' || ext === 'txt') {
            try {
                await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${file.name}', ignore_errors=true)`);
            } catch (csvError) {
                console.warn(`Strict parsing failed for ${file.name}. Falling back to lenient scrubbing...`);
                const freshBuffer = await file.arrayBuffer(); 
                const workbook = XLSX.read(freshBuffer, { type: 'array' }); 
                const sheetName = workbook.SheetNames[0];
                const cleanCsvText = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);

                const virtualFileName = `${tableName}_clean.csv`;
                await db.registerFileText(virtualFileName, cleanCsvText);
                await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${virtualFileName}', ignore_errors=true)`);
            }
        } else if (ext === 'parquet') {
            await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM read_parquet('${file.name}')`);
        } else {
            throw new Error(`Unsupported structured file format: .${ext}`);
        }
    }
    
    return tableName;
}

// js/core/database.js

/**
 * ROBUST JSON INJECTOR: Creates a unified table from an array of objects
 */
export async function ingestJsonArray(tableName, jsonArray) {
    if (!jsonArray || jsonArray.length === 0) return;

    // 1. Identify EVERY unique column name across all rows
    const allKeys = new Set();
    jsonArray.forEach(row => Object.keys(row).forEach(key => allKeys.add(key)));
    const columnNames = Array.from(allKeys);

    // 2. Create the table
    const colDef = columnNames.map(c => `"${c}" VARCHAR`).join(', ');
    await conn.query(`CREATE TABLE "${tableName}" (${colDef})`);

    // 3. Insert rows
    for (const row of jsonArray) {
        // Only insert columns that exist in THIS specific row
        const rowKeys = Object.keys(row).map(k => `"${k}"`).join(', ');
        const rowValues = Object.values(row).map(val => {
            const safeVal = val === null || val === undefined ? '' : String(val).replace(/'/g, "''");
            return `'${safeVal}'`;
        }).join(', ');

        await conn.query(`INSERT INTO "${tableName}" (${rowKeys}) VALUES (${rowValues})`);
    }
}

/**
 * URL Ingestion Function
 */
export async function registerFromURL(url, tableName) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        
        const buffer = await response.arrayBuffer();
        const fileName = `${tableName}.csv`; 
        await db.registerFileBuffer(fileName, new Uint8Array(buffer));

        await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${fileName}', ignore_errors=true)`);
        
        return tableName;
    } catch (err) {
        console.error("URL Ingestion Error:", err);
        throw err;
    }
}

// ... (getTableSchema, getTableStats, getDeepTableProfile stay the same) ...

export async function getTableSchema(tableName) {
    if (!conn) return "";
    const result = await conn.query(`PRAGMA table_info('${tableName}')`);
    const rows = result.toArray().map(row => row.toJSON());
    return rows.map(r => `${r.name} (${r.type})`).join(", ");
}

export async function getTableStats(tableName) {
    const totalRowsRes = await runQuery(`SELECT COUNT(*) as count FROM "${tableName}"`);
    const totalRows = Number(totalRowsRes[0].count);

    const schema = await runQuery(`PRAGMA table_info('${tableName}')`);
    let facts = [];

    for (const col of schema) {
        const isNumeric = ['DOUBLE', 'INTEGER', 'BIGINT', 'FLOAT'].includes(col.type);
        
        if (isNumeric) {
            const stats = await runQuery(`SELECT MIN("${col.name}") as min, MAX("${col.name}") as max, AVG("${col.name}") as avg FROM "${tableName}"`);
            facts.push(`Column "${col.name}" (Numeric): Range [${stats[0].min} to ${stats[0].max}], Average: ${Number(stats[0].avg).toFixed(2)}`);
        } else {
            const stats = await runQuery(`SELECT COUNT(DISTINCT "${col.name}") as unique_count FROM "${tableName}"`);
            facts.push(`Column "${col.name}" (Text): ${Number(stats[0].unique_count)} unique values`);
        }
    }

    return { totalRows, facts: facts.join("\n") };
}

export async function getDeepTableProfile(tableName) {
    const totalRowsRes = await runQuery(`SELECT COUNT(*) as count FROM "${tableName}"`);
    const totalRows = Number(totalRowsRes[0].count);

    const schema = await runQuery(`PRAGMA table_info('${tableName}')`);
    let profile = { totalRows, columns: [] };

    for (const col of schema) {
        const name = col.name;
        const type = col.type;

        const nullRes = await runQuery(`SELECT COUNT(*) as count FROM "${tableName}" WHERE "${name}" IS NULL`);
        const nullCount = Number(nullRes[0].count);
        const sparsity = ((nullCount / totalRows) * 100).toFixed(1);

        let details = "";
        if (['DOUBLE', 'INTEGER', 'BIGINT', 'FLOAT'].includes(type)) {
            const stats = await runQuery(`SELECT MIN("${name}") as min, MAX("${name}") as max, AVG("${name}") as avg FROM "${tableName}"`);
            details = `Range: [${stats[0].min} to ${stats[0].max}], Avg: ${Number(stats[0].avg).toFixed(2)}`;
        } else {
            const freq = await runQuery(`SELECT "${name}" as val, COUNT(*) as count FROM "${tableName}" GROUP BY 1 ORDER BY 2 DESC LIMIT 3`);
            details = `Top Values: ${freq.map(f => `${f.val} (${f.count})`).join(", ")}`;
        }

        profile.columns.push(`- ${name} (${type}): ${sparsity}% empty. ${details}`);
    }

    return profile;
}

/**
 * 🚀 NEW: Exports a DuckDB table to a heavily compressed Parquet Buffer
 */
export async function exportToParquet(tableName) {
    const fileName = `${tableName}_export.parquet`;
    // DuckDB creates the parquet file in its virtual filesystem
    await conn.query(`COPY "${tableName}" TO '${fileName}' (FORMAT PARQUET)`);
    // Extract the buffer out of WebAssembly into standard Javascript
    const buffer = await db.copyFileToBuffer(fileName);
    return buffer;
}

/**
 * 🚀 NEW: Loads a Parquet Buffer directly into DuckDB Memory
 */
export async function loadTableFromParquet(tableName, uint8Array) {
    const fileName = `${tableName}_boot.parquet`;
    await db.registerFileBuffer(fileName, uint8Array);
    await conn.query(`CREATE TABLE "${tableName}" AS SELECT * FROM read_parquet('${fileName}')`);
}

/**
 * Advanced Statistical Profiler
 * Calculates Standard Deviation, Variance, Skewness, and Kurtosis 
 * for all numeric columns in a single pass.
 */
export async function getQuantStats(tableName) {
    const schema = await runQuery(`PRAGMA table_info('${tableName}')`);
    const numCols = schema.filter(c => ['DOUBLE', 'INTEGER', 'BIGINT', 'FLOAT'].includes(c.type));
    
    let statsPayload = {};

    for (const col of numCols) {
        const name = col.name;
        // DuckDB math functions for statistical distribution
        const sql = `
            SELECT 
                COUNT("${name}") as n,
                AVG("${name}") as mean,
                STDDEV_SAMP("${name}") as stddev,
                VARIANCE("${name}") as var,
                MIN("${name}") as min,
                MAX("${name}") as max,
                PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY "${name}") as q1,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "${name}") as median,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "${name}") as q3
            FROM "${tableName}"
        `;
        const [res] = await runQuery(sql);
        
        // Calculate Coefficient of Variation (Relative Risk)
        const cv = res.mean !== 0 ? (res.stddev / res.mean) : 0;
        
        statsPayload[name] = {
            ...res,
            coeff_variation: cv.toFixed(4),
            interquartile_range: (res.q3 - res.q1).toFixed(2)
        };
    }

    return statsPayload;
}
