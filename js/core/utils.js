// js/core/utils.js

export async function fetchWithRetry(url, options, retries = 4, backoff = 3000) {
    try {
        const response = await fetch(url, options);

        // 503 and 504 mean the server is melting. 429 means you are too fast.
        const retryCodes = [429, 503, 504]; 

        if (retryCodes.includes(response.status)) {
            if (retries > 0) {
                const statusMsg = response.status === 429 
                    ? "Rate limit reached. Pausing..." 
                    : "Mistral servers are overloaded. Retrying with fallback pathways...";

                window.dispatchEvent(new CustomEvent('agent-status-update', { 
                    detail: statusMsg 
                }));
                
                // 🚀 ADD JITTER: Randomness prevents "sync-lock" with the server
                const jitter = Math.random() * 1000; 
                await new Promise(resolve => setTimeout(resolve, backoff + jitter));
                
                // Retry with longer wait
                return fetchWithRetry(url, options, retries - 1, backoff * 2);
            }
        }
        return response;
    } catch (error) {
        if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        throw error;
    }
}
