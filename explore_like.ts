import { PlaywrightMCP } from './src/browser.js';
import { browserSession, runWithTimeout } from './src/runtime.js';
import * as fs from 'fs';

async function main() {
    console.log("Starting browser session...");
    await browserSession(PlaywrightMCP, async (page) => {
        await page.goto('https://x.com/vikingmute/status/2033156347504767135');
        await page.wait(5); // Wait for hydration
        
        console.log("Analyzing data-testids...");
        const result = await page.evaluate(`(async () => {
            const elements = document.querySelectorAll('*[data-testid]');
            const testIds = Array.from(elements).map(el => el.getAttribute('data-testid'));
            const uniqueIds = [...new Set(testIds)];
            
            // Focus on action buttons
            const actionIds = uniqueIds.filter(id => 
                id.toLowerCase().includes('like') || 
                id.toLowerCase().includes('heart') ||
                id.toLowerCase().includes('retweet') ||
                id.toLowerCase().includes('reply')
            );
            return { actionIds, all: uniqueIds };
        })()`);
        
        fs.writeFileSync('like_testids.json', JSON.stringify(result, null, 2));
        console.log(`Captured ${result.actionIds.length} potential action test IDs. Saved to like_testids.json`);
    });
}

main().catch(console.error);
