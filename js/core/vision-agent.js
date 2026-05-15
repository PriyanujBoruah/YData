// js/core/vision-agent.js
import { fetchWithRetry } from './utils.js';

const MISTRAL_API_KEY = import.meta.env.VITE_MISTRAL_API_KEY; 
const API_URL = "https://api.mistral.ai/v1";

// Ensure PDF.js worker is configured
if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/**
 * 🚀 THE "LENS" TUNE: Image Pre-processing
 * Uses a hidden canvas to strip noise and boost contrast locally.
 * This significantly improves Tesseract's ability to read blurry or dark photos.
 */
async function preprocessImage(source) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;

            // Apply filters: Grayscale + High Contrast + Slight Brightness boost
            ctx.filter = 'grayscale(100%) contrast(150%) brightness(110%)';
            ctx.drawImage(img, 0, 0);

            // Export as high-quality PNG data URL
            resolve(canvas.toDataURL('image/png'));
        };

        if (source instanceof File) {
            img.src = URL.createObjectURL(source);
        } else if (source instanceof HTMLCanvasElement) {
            img.src = source.toDataURL();
        }
    });
}

/**
 * 🚀 THE "ENGINE" TUNE: Optimized OCR logic
 */
export async function performOCR(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    
    // 1. Initialize Worker with English + Hindi support for Bharat Localization
    const worker = await Tesseract.createWorker('eng+hin');

    // 2. TUNE PARAMETERS: 
    // PSM 6: Assume a single uniform block of text (Best for table rows/invoices)
    await worker.setParameters({
        tessedit_pageseg_mode: '6',
        tessjs_create_hocr: '0',
        tessjs_create_tsv: '0',
    });

    if (extension === 'pdf') {
        const text = await performPdfOCR(file, worker);
        await worker.terminate();
        return text;
    } else {
        // Apply Lens Tune
        const processedImage = await preprocessImage(file);
        const ret = await worker.recognize(processedImage);
        await worker.terminate();
        return ret.data.text;
    }
}

/**
 * PDF.js Helper with Lens Tune applied to every page
 */
async function performPdfOCR(file, worker) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";

    // Limit to first 5 pages to prevent browser memory crashes
    const numPages = Math.min(pdf.numPages, 5); 
    
    for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); // High scale for clear OCR
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        
        // Apply Lens Tune to the PDF page before OCR
        const processedPage = await preprocessImage(canvas);
        const { data: { text } } = await worker.recognize(processedPage);
        
        fullText += `\n--- Page ${i} ---\n${text}`;
    }
    return fullText;
}

/**
 * 2. Structure messy text into JSON (The Neural Healer)
 * Upgraded to handle OCR character errors and Indian business context.
 */
export async function structureText(rawText) {
    const response = await fetchWithRetry(`${API_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({
            model: "mistral-small-latest",
            messages:[{
                role: "system",
                content: `You are an expert Data Architect specializing in the Indian market. 
                
                TASK: Extract tabular data from messy OCR text into clean JSON.
                
                NEURAL HEALING RULES:
                1. ERROR CORRECTION: OCR often swaps '0' for 'O' or 'l' for '1'. Correct these based on business logic (e.g., amounts/prices should be numbers).
                2. BHARAT CONTEXT: Standardize Indian numbering (Lakhs/Crores) and currency (₹).
                3. SCHEMA: Infer the best logical column names (e.g., Invoice_Date, GSTIN, Description, Taxable_Value).
                4. Output ONLY a JSON object containing an array called "data".
                
                Example: {"data":[{"Item": "Inventory", "Amount": 50000, "Tax": 9000}]}`
            }, {
                role: "user",
                content: rawText
            }],
            response_format: { type: "json_object" },
            temperature: 0.1 
        })
    });
    
    if (!response.ok) throw new Error("Neural structuring failed");
    const result = await response.json();
    return JSON.parse(result.choices[0].message.content).data;
}

/**
 * 3. Create Vector Embeddings for RAG
 */
export async function getEmbeddings(text) {
    const res = await fetchWithRetry(`${API_URL}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({ 
            model: "mistral-embed-2312", 
            input: [text] 
        })
    });
    
    if (!res.ok) throw new Error("Failed to generate embeddings");
    const json = await res.json();
    return json.data[0].embedding; 
}

/**
 * BATCH SYNTHESIZER: Takes an array of raw OCR texts and 
 * uses Mistral to design a unified CSV structure.
 */
export async function synthesizeToUnifiedCSV(textArray) {
    const combinedText = textArray.map((t, i) => `[DOCUMENT ${i+1}]\n${t}`).join('\n\n---\n\n');

    const response = await fetchWithRetry(`${API_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_API_KEY}` },
        body: JSON.stringify({
            model: "mistral-small-latest",
            messages:[{
                role: "system",
                content: `You are a Master Data Architect. You are given raw OCR text from multiple documents.
                
                TASK:
                1. Identify all unique data points across ALL documents.
                2. Design a single, unified CSV schema that can represent all documents.
                3. If a document is missing a specific column, leave it empty in that row.
                4. Output ONLY the raw CSV text. No explanations. No markdown.
                
                CSV FORMAT RULES:
                - Use a header row.
                - Use double quotes for all values to handle commas: "Value","Value"
                - Ensure the CSV is perfectly valid.`
            }, {
                role: "user",
                content: combinedText
            }],
            temperature: 0.1 
        })
    });
    
    if (!response.ok) throw new Error("Synthesis failed");
    const result = await response.json();
    return result.choices[0].message.content.trim();
}
